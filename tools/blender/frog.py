"""Build the Octoventure soft-toon motorbike frog and export public/models/frog.glb.

Run:
    /opt/blender/blender -b --python tools/blender/frog.py

A cute toon Litoria moorei (WA motorbike frog): golden-green back with
dark olive blotches (value contrast for colour-blind players), cream
belly, gold eye rings, big friendly eyes and toe pads.

Scale
-----
The in-game octopus is 20 cm = 0.63 u (1 cm = 0.0315 u). This frog is
6 cm snout-to-vent = 0.189 u, already in world units. Hookup uses
visual scale 1.0.

Orientation
-----------
Modelled in Blender with +Z up and the face toward -Y; the glTF exporter
(export_yup=True) maps that to +Y up, +Z forward. Origin is on the
ground, between the feet.

Animations
----------
- idle (2.5 s): throat pulse and a blink
- hop (0.6 s): a single forward hop pose; root motion is NOT baked
- croak (0.8 s): throat sac puffs
- tongue (0.3 s): a short tongue flick
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
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
GLB_PATH = ROOT / "public" / "models" / "frog.glb"
PREVIEW_REPO = ROOT / "tools" / "blender" / "frog-preview.png"
PREVIEW_REPO_SIDE = ROOT / "tools" / "blender" / "frog-preview-side.png"
PREVIEW_REPO_HOP = ROOT / "tools" / "blender" / "frog-hop.png"
PREVIEW_REPO_CROAK = ROOT / "tools" / "blender" / "frog-croak.png"
PREVIEW_WORKSPACE = Path("/workspace/frog-preview.png")
PREVIEW_SIDE = Path("/workspace/frog-preview-side.png")
PREVIEW_HOP = Path("/workspace/frog-hop.png")
PREVIEW_CROAK = Path("/workspace/frog-croak.png")

CM = 0.0315
LENGTH_CM = 6.0
EXPORT_LENGTH = LENGTH_CM * CM  # 0.189 u

# Fresh saturated toon palette. Lime back to gold flanks, dark olive
# blotches with a lighter rim (value contrast for colour-blind players),
# cream belly, gold eye ring. Authored a touch bright so Standard+Workbench
# midtones stay lime rather than khaki.
BACK = (0xA8 / 255, 0xEC / 255, 0x3C / 255, 1.0)       # #A8EC3C, a touch brighter than #9ED93A
FLANK = (0xE8 / 255, 0xC8 / 255, 0x3A / 255, 1.0)      # #E8C83A
BLOTCH = (0x2A / 255, 0x32 / 255, 0x14 / 255, 1.0)      # #2A3214 dark olive core
BLOTCH_RIM = (0x6B / 255, 0x7A / 255, 0x32 / 255, 1.0)  # #6B7A32 lighter rim
BELLY = (0xF4 / 255, 0xE8 / 255, 0xC8 / 255, 1.0)       # #F4E8C8
RING = (0xE8 / 255, 0xB4 / 255, 0x3A / 255, 1.0)        # #E8B43A
EYE = (0x14 / 255, 0x14 / 255, 0x16 / 255, 1.0)         # glossy near-black
HIGHLIGHT = (1.0, 1.0, 1.0, 1.0)
MOUTH = (0x3A / 255, 0x28 / 255, 0x1C / 255, 1.0)       # #3A281C
PAD = (0xF0 / 255, 0xC8 / 255, 0xB0 / 255, 1.0)         # #F0C8B0
THROAT = (0xF6 / 255, 0xD8 / 255, 0xC0 / 255, 1.0)      # #F6D8C0
TONGUE = (0xE8 / 255, 0x7A / 255, 0x7A / 255, 1.0)      # #E87A7A
LEG = (0xC8 / 255, 0xD4 / 255, 0x3A / 255, 1.0)         # #C8D43A, between lime and gold

FPS = 24
IDLE_FRAMES = 60          # 2.5 s
HOP_FRAMES = 14           # ~0.58 s, about 0.6 s
CROAK_FRAMES = 19         # ~0.79 s
TONGUE_FRAMES = 7         # ~0.29 s


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                  bpy.data.actions, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = max(IDLE_FRAMES, HOP_FRAMES, CROAK_FRAMES, TONGUE_FRAMES)
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
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = color if emission else (0, 0, 0, 1)
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = emission
    return mat


def set_coat(mat, weight, roughness=0.22):
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
    if mesh.polygons:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()


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


def on_ellipsoid(center, half, direction, embed=1.0):
    d = Vector(direction)
    if d.length < 1e-9:
        d = Vector((0.0, 0.0, 1.0))
    d.normalize()
    return Vector(center) + Vector((half.x * d.x, half.y * d.y, half.z * d.z)) * embed


def add_surface_disc(name, surface, normal, radius, thickness=0.30, segments=12, rings=3, inset=0.12):
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


def add_cylinder_between(name, p0, p1, radius, verts=8):
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


def add_tapered_tube(name, points, radii, verts=10, extra_rings=1, cap=True):
    """Loft a smooth tapered tube through points with per-point radii."""
    pts = [Vector(p) for p in points]
    rads = [float(r) for r in radii]
    if len(pts) != len(rads) or len(pts) < 2:
        raise ValueError("points and radii must be the same length, at least 2")

    ring_pts = [pts[0]]
    ring_r = [rads[0]]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ra, rb = rads[i], rads[i + 1]
        for k in range(1, extra_rings + 1):
            t = k / (extra_rings + 1)
            s = t * t * (3.0 - 2.0 * t)
            ring_pts.append(a.lerp(b, s))
            ring_r.append(ra + (rb - ra) * s)
        ring_pts.append(pts[i + 1])
        ring_r.append(rads[i + 1])

    def tangent(i):
        if i == 0:
            d = ring_pts[1] - ring_pts[0]
        elif i == len(ring_pts) - 1:
            d = ring_pts[-1] - ring_pts[-2]
        else:
            d = ring_pts[i + 1] - ring_pts[i - 1]
        if d.length < 1e-9:
            d = Vector((0.0, 0.0, 1.0))
        return d.normalized()

    verts_co = []
    faces = []
    prev_t = prev_n = prev_b = None
    for i, (p, r) in enumerate(zip(ring_pts, ring_r)):
        tan = tangent(i)
        if prev_n is None:
            ref = Vector((0.0, 0.0, 1.0))
            if abs(tan.dot(ref)) > 0.9:
                ref = Vector((1.0, 0.0, 0.0))
            n = tan.cross(ref).normalized()
            b = tan.cross(n).normalized()
            n = b.cross(tan).normalized()
        else:
            axis = prev_t.cross(tan)
            if axis.length < 1e-8:
                n, b = prev_n, prev_b
            else:
                rot = prev_t.rotation_difference(tan)
                n = (rot @ prev_n).normalized()
                b = tan.cross(n).normalized()
                n = b.cross(tan).normalized()
        prev_t, prev_n, prev_b = tan, n, b
        for j in range(verts):
            ang = 2.0 * math.pi * j / verts
            verts_co.append(p + (math.cos(ang) * n + math.sin(ang) * b) * r)

    n_rings = len(ring_pts)
    for i in range(n_rings - 1):
        for j in range(verts):
            a = i * verts + j
            b = i * verts + (j + 1) % verts
            c = (i + 1) * verts + (j + 1) % verts
            d = (i + 1) * verts + j
            faces.append((a, b, c, d))
    if cap:
        start_c = len(verts_co)
        verts_co.append(ring_pts[0])
        for j in range(verts):
            faces.append((start_c, (j + 1) % verts, j))
        end_c = len(verts_co)
        verts_co.append(ring_pts[-1])
        last = (n_rings - 1) * verts
        for j in range(verts):
            faces.append((end_c, last + j, last + (j + 1) % verts))

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts_co, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    shade_smooth(obj)
    return obj


def assign_chain_weights(obj, joints, bone_names, parent_bone=None):
    """Skin a tube along a joint polyline (N joints, N-1 bone names)."""
    joints = [Vector(j) for j in joints]
    segs = [(joints[i], joints[i + 1]) for i in range(len(bone_names))]
    existing = {vg.name: vg for vg in obj.vertex_groups}
    groups = {}
    names = list(bone_names)
    if parent_bone:
        names = [parent_bone] + names
    for n in names:
        groups[n] = existing.get(n) or obj.vertex_groups.new(name=n)
    for vi, v in enumerate(obj.data.vertices):
        p = v.co
        best_d, best_i, best_t = 1e9, 0, 0.0
        for i, (a, b) in enumerate(segs):
            ab = b - a
            l2 = ab.length_squared
            t = 0.0 if l2 < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / l2))
            q = a + ab * t
            d = (p - q).length
            if d < best_d:
                best_d, best_i, best_t = d, i, t
        weights = {n: 0.0 for n in groups}
        name = bone_names[best_i]
        if best_i == 0 and best_t < 0.28 and parent_bone:
            w = best_t / 0.28
            weights[parent_bone] = 1.0 - w
            weights[name] = w
        elif best_t < 0.22 and best_i > 0:
            w = best_t / 0.22
            weights[bone_names[best_i - 1]] = 1.0 - w
            weights[name] = w
        elif best_t > 0.78 and best_i < len(bone_names) - 1:
            w = (best_t - 0.78) / 0.22
            weights[name] = 1.0 - w
            weights[bone_names[best_i + 1]] = w
        else:
            weights[name] = 1.0
        for n, w in weights.items():
            if w > 1e-4:
                groups[n].add([vi], w, "REPLACE")


def add_torus(name, loc, major, minor, major_seg=12, minor_seg=6, direction=None):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major,
        minor_radius=minor,
        major_segments=major_seg,
        minor_segments=minor_seg,
        location=loc,
    )
    obj = bpy.context.active_object
    obj.name = name
    if direction is not None:
        n = Vector(direction)
        if n.length < 1e-9:
            n = Vector((0.0, 0.0, 1.0))
        n.normalize()
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(n)
    apply_all(obj)
    shade_smooth(obj)
    return obj


def assign_group(obj, group_name, weight=1.0):
    vg = obj.vertex_groups.new(name=group_name)
    n = len(obj.data.vertices)
    if n:
        vg.add(list(range(n)), weight, "REPLACE")


def assign_weights(obj, pairs):
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
    return obj


def boolean_union(base, others):
    """Merge closed meshes into one, so overlapping spheres don't leave a crease."""
    bpy.context.view_layer.objects.active = base
    base.select_set(True)
    for obj in others:
        mod = base.modifiers.new("Union", "BOOLEAN")
        mod.operation = "UNION"
        # Prefer MANIFOLD for closed spheres; fall back to EXACT.
        for solver in ("MANIFOLD", "EXACT", "FLOAT"):
            try:
                mod.solver = solver
                break
            except TypeError:
                continue
        mod.object = obj
        bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(obj, do_unlink=True)
    shade_smooth(base)
    try:
        base.data.normals_split_custom_set(None)
    except Exception:
        pass
    if hasattr(base.data, "calc_normals_split"):
        try:
            base.data.calc_normals_split()
        except Exception:
            pass
    return base


def triangle_count(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def build_armature(bones):
    data = bpy.data.armatures.new("FrogArmature")
    data.display_type = "OCTAHEDRAL"
    arm = bpy.data.objects.new("FrogArmature", data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    edit = {}
    for name, parent, head, tail in bones:
        eb = data.edit_bones.new(name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        if (eb.tail - eb.head).length < 0.004 * CM:
            direction = (Vector(tail) - Vector(head))
            if direction.length < 1e-9:
                direction = Vector((0, 0, 1))
            eb.tail = eb.head + direction.normalized() * (0.08 * CM)
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


def key_scale(pb, frame, scale, interpolation="BEZIER"):
    pb.scale = Vector(scale)
    pb.keyframe_insert(data_path="scale", frame=frame)
    if pb.id_data.animation_data and pb.id_data.animation_data.action:
        action = pb.id_data.animation_data.action
        for fc in action.fcurves:
            if fc.data_path == f'pose.bones["{pb.name}"].scale':
                for kp in fc.keyframe_points:
                    if int(kp.co.x) == frame:
                        kp.interpolation = interpolation


def key_loc(pb, frame, loc, interpolation="BEZIER"):
    pb.location = Vector(loc)
    pb.keyframe_insert(data_path="location", frame=frame)
    if pb.id_data.animation_data and pb.id_data.animation_data.action:
        action = pb.id_data.animation_data.action
        for fc in action.fcurves:
            if fc.data_path == f'pose.bones["{pb.name}"].location':
                for kp in fc.keyframe_points:
                    if int(kp.co.x) == frame:
                        kp.interpolation = interpolation


def key_rest(arm, frame):
    """Key a rest pose on every bone so clips don't leak into each other."""
    for pb in arm.pose.bones:
        key_euler(pb, frame, (0, 0, 0))
        key_scale(pb, frame, (1, 1, 1))
        key_loc(pb, frame, (0, 0, 0))


def push_nla(arm, action, name):
    if arm.animation_data is None:
        arm.animation_data_create()
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    start = 1
    for existing in arm.animation_data.nla_tracks:
        for strip in existing.strips:
            start = max(start, int(strip.frame_end) + 2)
    strip = track.strips.new(name, start, action)
    strip.action = action
    return track


def add_leg(parts, mats, tag, joints, radii, parent_bone, names, n_toes=4):
    """One smooth tapered skinned tube plus short attached toes.

    joints: hip, knee, ankle, toe. names: thigh, shin, foot.
    """
    hip, knee, ankle, toe = [Vector(p) for p in joints]
    r_hip, r_knee, r_ankle, r_toe = radii

    # Start the tube slightly inside the body so the hip is tucked, not a boxy joint.
    inward = Vector((-1.0 if hip.x > 0 else 1.0, 0.0, 0.0))
    hip_in = hip + inward * (r_hip * 0.55)

    # Mid-points keep the taper smooth through the fold.
    mid_shin = knee.lerp(ankle, 0.5)
    points = [hip_in, hip, knee, mid_shin, ankle, toe]
    rads = [
        r_hip * 1.05,
        r_hip * 1.00,
        r_knee * 1.02,
        (r_knee + r_ankle) * 0.52,
        r_ankle * 1.00,
        r_toe * 0.95,
    ]
    tube = add_tapered_tube(f"{tag}_leg", points, rads, verts=10, extra_rings=0, cap=True)
    set_material(tube, mats["leg"])
    assign_chain_weights(tube, [hip, knee, ankle, toe], names, parent_bone=parent_bone)
    parts.append(tube)

    # 3-4 short rounded toes growing out of the foot, each ending in a
    # small round pad that sits on the ground and overlaps the digit.
    fwd = toe - ankle
    if fwd.length < 1e-9:
        fwd = Vector((0.0, -1.0, 0.0))
    fwd.normalize()
    # Prefer a mostly-horizontal forward so pads plant cleanly.
    fwd_flat = Vector((fwd.x, fwd.y, 0.0))
    if fwd_flat.length < 1e-6:
        fwd_flat = Vector((0.0, -1.0, 0.0))
    fwd_flat.normalize()
    side = Vector((1.0 if hip.x > 0 else -1.0, 0.0, 0.0))
    # Fan from the last bit of the foot, overlapping the tube tip.
    origin = toe - fwd_flat * (0.10 * CM)
    origin.z = max(origin.z, r_toe * 0.85)
    toe_len = 0.38 * CM
    if n_toes == 3:
        spreads = (-0.85, 0.0, 0.85)
        reaches = (0.90, 1.10, 0.90)
    else:
        spreads = (-1.15, -0.40, 0.40, 1.15)
        reaches = (0.88, 1.08, 1.08, 0.88)
    pad_r = 0.13 * CM
    for i, (sp, reach) in enumerate(zip(spreads, reaches)):
        tip = Vector((
            origin.x + side.x * sp * pad_r * 1.55 + fwd_flat.x * reach * toe_len,
            origin.y + side.y * sp * pad_r * 1.55 + fwd_flat.y * reach * toe_len,
            pad_r * 0.95,
        ))
        start = origin.lerp(tip, 0.08)
        start.z = max(start.z, r_toe * 0.55)
        digit = add_tapered_tube(
            f"{tag}_toe{i}",
            [start, tip],
            [r_toe * 0.62, pad_r * 0.70],
            verts=6,
            extra_rings=0,
            cap=True,
        )
        set_material(digit, mats["leg"])
        assign_group(digit, names[2])
        parts.append(digit)
        pad_loc = Vector((tip.x, tip.y, pad_r * 0.72))
        pad = add_uv_sphere(
            f"{tag}_pad{i}", pad_r, 6, 3, pad_loc,
            scale=Vector((1.15, 1.15, 0.70)),
        )
        set_material(pad, mats["pad"])
        assign_group(pad, names[2])
        parts.append(pad)

    return [
        (names[0], parent_bone, hip, knee),
        (names[1], names[0], knee, ankle),
        (names[2], names[1], ankle, toe),
    ]


def build_meshes(mats):
    """Return (parts, bones). Face toward Blender -Y."""
    parts = []
    bones = []

    # 6 cm snout-to-vent. Head and body overlap a wide neck so they read
    # as one rounded frog shape, not two stacked balls.
    body_c = Vector((0.0, 0.30, 1.50)) * CM
    body_s = Vector((1.72, 2.20, 1.30)) * CM
    head_c = Vector((0.0, -1.65, 1.65)) * CM
    head_s = Vector((1.58, 1.50, 1.14)) * CM
    neck_c = Vector((0.0, -0.90, 1.58)) * CM
    neck_s = Vector((1.80, 1.45, 1.28)) * CM

    body = add_uv_sphere("body", 1.0, 14, 9, body_c, scale=body_s)
    set_material(body, mats["back"])
    assign_group(body, "spine")

    neck = add_uv_sphere("neck", 1.0, 10, 6, neck_c, scale=neck_s)
    set_material(neck, mats["back"])
    assign_weights(neck, [("spine", 0.55), ("head", 0.45)])

    head = add_uv_sphere("head", 1.0, 14, 9, head_c, scale=head_s)
    set_material(head, mats["back"])
    assign_group(head, "head")

    # Soft snout so the face is a wide frog wedge, not a sphere.
    snout_c = Vector((0.0, -2.70, 1.52)) * CM
    snout_s = Vector((1.18, 0.90, 0.82)) * CM
    snout = add_uv_sphere("snout", 1.0, 12, 8, snout_c, scale=snout_s)
    set_material(snout, mats["back"])
    assign_group(snout, "head")
    # Boolean-union the lime shell so the head flows into the back
    # as one rounded shape, not four overlapping balls with a collar crease.
    body = boolean_union(body, [neck, head, snout])
    body.name = "body"
    set_material(body, mats["back"])
    # Weights by position: snout/head in front, spine on the back, blend in the neck.
    if body.vertex_groups.get("spine"):
        body.vertex_groups.remove(body.vertex_groups["spine"])
    if body.vertex_groups.get("head"):
        body.vertex_groups.remove(body.vertex_groups["head"])
    vg_s = body.vertex_groups.new(name="spine")
    vg_h = body.vertex_groups.new(name="head")
    y_head = -1.30 * CM
    y_spine = -0.40 * CM
    for i, v in enumerate(body.data.vertices):
        y = v.co.y
        if y <= y_head:
            vg_h.add([i], 1.0, "REPLACE")
        elif y >= y_spine:
            vg_s.add([i], 1.0, "REPLACE")
        else:
            w = (y - y_head) / (y_spine - y_head)
            vg_h.add([i], 1.0 - w, "REPLACE")
            vg_s.add([i], w, "REPLACE")
    parts.append(body)

    # Gold flanks under the lime back, so the colour reads lime-to-gold.
    for side, tag in ((1, "L"), (-1, "R")):
        flank_c = Vector((side * 1.40, 0.10, 0.95)) * CM
        flank_s = Vector((0.50, 1.25, 0.68)) * CM
        flank = add_uv_sphere(f"flank_{tag}", 1.0, 8, 5, flank_c, scale=flank_s)
        set_material(flank, mats["flank"])
        assign_group(flank, "spine")
        parts.append(flank)

    # Cream belly, tucked under the body, just clear of the ground.
    belly_c = Vector((0.0, 0.20, 0.52)) * CM
    belly_s = Vector((1.35, 1.90, 0.55)) * CM
    belly = add_uv_sphere("belly", 1.0, 10, 6, belly_c, scale=belly_s)
    set_material(belly, mats["belly"])
    assign_group(belly, "spine")
    parts.append(belly)

    # Throat sac under the chin, for idle pulse and croak.
    throat_c = Vector((0.0, -1.55, 0.62)) * CM
    throat_s = Vector((0.72, 0.58, 0.48)) * CM
    throat = add_uv_sphere("throat", 1.0, 8, 5, throat_c, scale=throat_s)
    set_material(throat, mats["throat"])
    assign_group(throat, "throat")
    parts.append(throat)

    # Soft dark blotches with a lighter rim, so they read by value.
    blotches = [
        (body_c, body_s, (0.35, -0.15, 0.90), 0.44, "spine"),
        (body_c, body_s, (-0.40, 0.20, 0.85), 0.38, "spine"),
        (body_c, body_s, (0.15, 0.55, 0.80), 0.34, "spine"),
        (body_c, body_s, (0.00, 0.15, 0.98), 0.32, "spine"),
        (head_c, head_s, (0.50, 0.15, 0.72), 0.22, "head"),
        (head_c, head_s, (-0.45, 0.10, 0.76), 0.20, "head"),
    ]
    for i, (center, half, direction, rad_cm, group) in enumerate(blotches):
        surface = on_ellipsoid(center, half, direction, 1.0)
        normal = ellipsoid_normal(center, half, surface)
        blot = add_surface_disc(
            f"blotch_{i}", surface, normal, rad_cm * CM,
            thickness=0.30, segments=10, rings=3, inset=0.10,
        )
        set_material(blot, mats["blotch"])
        assign_group(blot, group)
        parts.append(blot)

    # Big friendly eyes: a smooth dark globe on the top-sides of the
    # head, a gold lid-ring, one round highlight. Look is forward with a
    # slight outward bias so they are not cross-eyed and still read
    # from the side.
    eye_bones = {}
    for side, name in ((1, "eye_L"), (-1, "eye_R")):
        loc = on_ellipsoid(head_c, head_s, (side * 0.72, -0.42, 0.78), 1.04)
        eye_r = 0.50 * CM
        look = Vector((side * 0.22, -0.92, 0.18)).normalized()
        # Dark globe is the eye you see from every angle.
        eyeball = add_uv_sphere(name, eye_r, 12, 8, loc)
        set_material(eyeball, mats["eye"])
        assign_group(eyeball, name)
        parts.append(eyeball)
        # Gold lid-ring sits on the socket, behind the globe, so it never
        # cuts a line across the pupil.
        ring = add_surface_disc(
            name + "_ring",
            loc - look * (eye_r * 0.55),
            look,
            eye_r * 1.05,
            thickness=0.28, segments=10, rings=3, inset=0.0,
        )
        set_material(ring, mats["ring"])
        assign_group(ring, name)
        parts.append(ring)
        # One round catchlight on the surface, upper-front.
        hl_dir = (look + Vector((0.0, 0.0, 0.50))).normalized()
        hl = add_uv_sphere(
            name + "_hl", 0.14 * CM, 6, 3,
            loc + hl_dir * (eye_r * 0.90),
        )
        set_material(hl, mats["highlight"])
        assign_group(hl, name)
        parts.append(hl)
        eye_bones[name] = (loc, loc + look * (0.22 * CM))

    # Slight smile: a clean soft curve sitting on the snout surface.
    smile_dirs = [
        (-0.46, -0.72, -0.30),
        (-0.26, -0.86, -0.42),
        (0.00, -0.95, -0.52),
        (0.26, -0.86, -0.42),
        (0.46, -0.72, -0.30),
    ]
    smile_pts = [on_ellipsoid(snout_c, snout_s, d, 1.00) for d in smile_dirs]
    smile_r = [0.032 * CM, 0.038 * CM, 0.042 * CM, 0.038 * CM, 0.032 * CM]
    smile = add_tapered_tube(
        "smile", smile_pts, smile_r,
        verts=5, extra_rings=0, cap=True,
    )
    set_material(smile, mats["mouth"])
    assign_group(smile, "head")
    parts.append(smile)

    # A short tongue, tucked in at rest, ready for the flick clip.
    tongue_c = Vector((0.0, -2.95, 1.18)) * CM
    tongue = add_uv_sphere("tongue", 1.0, 6, 4, tongue_c, scale=Vector((0.20, 0.38, 0.12)) * CM)
    set_material(tongue, mats["tongue"])
    assign_group(tongue, "tongue")
    parts.append(tongue)
    tongue_tip = tongue_c + Vector((0.0, -0.25, 0.0)) * CM

    # Front legs short and planted; hind legs a tucked Z-fold against the body.
    front_r = (0.36 * CM, 0.30 * CM, 0.22 * CM, 0.16 * CM)
    back_r = (0.52 * CM, 0.46 * CM, 0.28 * CM, 0.18 * CM)
    for side, tag in ((1, "fl"), (-1, "fr")):
        s = float(side)
        joints = [
            Vector((s * 1.15, -1.05, 1.15)) * CM,
            Vector((s * 1.28, -1.55, 0.70)) * CM,
            Vector((s * 1.22, -1.95, 0.24)) * CM,
            Vector((s * 1.18, -2.28, 0.12)) * CM,
        ]
        names = [f"{tag}_thigh", f"{tag}_shin", f"{tag}_foot"]
        bones.extend(add_leg(parts, mats, tag, joints, front_r, "spine", names, n_toes=3))
    for side, tag in ((1, "bl"), (-1, "br")):
        s = float(side)
        # Hip tucked into the flank; knee only slightly further out and
        # back, shin folds down and forward, foot plants pointing ahead.
        joints = [
            Vector((s * 1.15, 0.70, 1.28)) * CM,
            Vector((s * 1.18, 1.70, 1.52)) * CM,
            Vector((s * 1.22, 0.50, 0.28)) * CM,
            Vector((s * 1.18, -0.45, 0.12)) * CM,
        ]
        names = [f"{tag}_thigh", f"{tag}_shin", f"{tag}_foot"]
        bones.extend(add_leg(parts, mats, tag, joints, back_r, "spine", names, n_toes=4))

    # Core bones
    root_tail = Vector((0.0, 0.0, 0.4)) * CM
    spine_head = Vector((0.0, 0.15, 0.55)) * CM
    spine_tail = Vector((0.0, 0.35, 1.55)) * CM
    head_bone_h = head_c + Vector((0.0, 0.40, -0.10)) * CM
    head_bone_t = head_c + Vector((0.0, -0.80, 0.15)) * CM
    throat_h = throat_c + Vector((0.0, 0.20, 0.05)) * CM
    throat_t = throat_c + Vector((0.0, -0.25, -0.10)) * CM
    tongue_h = tongue_c
    tongue_t = tongue_tip

    core = [
        ("root", None, Vector((0.0, 0.0, 0.0)), root_tail),
        ("spine", "root", spine_head, spine_tail),
        ("head", "spine", head_bone_h, head_bone_t),
        ("throat", "head", throat_h, throat_t),
        ("tongue", "head", tongue_h, tongue_t),
        ("eye_L", "head", eye_bones["eye_L"][0], eye_bones["eye_L"][1]),
        ("eye_R", "head", eye_bones["eye_R"][0], eye_bones["eye_R"][1]),
    ]
    bones = core + bones
    return parts, bones


def zero_pose(arm):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
        pb.location = (0, 0, 0)


def animate_idle(arm):
    action = ensure_action(arm, "idle", IDLE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, IDLE_FRAMES)
    # Gentle throat pulse and a little breath in the spine.
    throat = arm.pose.bones["throat"]
    spine = arm.pose.bones["spine"]
    head = arm.pose.bones["head"]
    for fr, pulse, breath, nod in (
        (0, 1.00, 0.0, 0.0),
        (15, 1.12, 0.03, 2.0),
        (30, 0.96, -0.01, -1.0),
        (45, 1.14, 0.04, 1.5),
        (60, 1.00, 0.0, 0.0),
    ):
        key_scale(throat, fr, (pulse, pulse * 1.08, pulse))
        key_euler(spine, fr, (math.radians(breath * 8), 0, 0))
        key_euler(head, fr, (math.radians(nod * 0.4), 0, 0))
    # Blinks: quick squash on both eyes.
    for name in ("eye_L", "eye_R"):
        pb = arm.pose.bones[name]
        for fr, sc in ((0, 1.0), (18, 1.0), (20, 0.15), (22, 1.0), (44, 1.0), (46, 0.15), (48, 1.0), (60, 1.0)):
            key_scale(pb, fr, (1.0, sc, 1.0) if sc < 1 else (1, 1, 1), interpolation="LINEAR")
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "idle")
    return action


def animate_hop(arm):
    """One-shot hop pose. No root translation — the game moves the frog."""
    action = ensure_action(arm, "hop", HOP_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, HOP_FRAMES)

    def leg(tag, fr, thigh, shin, foot):
        key_euler(arm.pose.bones[f"{tag}_thigh"], fr, thigh)
        key_euler(arm.pose.bones[f"{tag}_shin"], fr, shin)
        key_euler(arm.pose.bones[f"{tag}_foot"], fr, foot)

    # Signs are empirical; left/right share the same local eulers because
    # bones are built along each limb (hip -> knee -> ankle).
    # Rest is 0. Crouch folds the legs; mid-air extends them back.
    r = math.radians
    spine = arm.pose.bones["spine"]
    head = arm.pose.bones["head"]
    keys = {
        # Modest hinges only. The game translates the frog along +Z and
        # lifts it; this clip is just squash, stretch and a kick pose.
        # Frame 3 (coil) is the proven direction; mid-air uses a smaller
        # opposite pitch and a slightly opened kick, not a 50-degree tumble.
        0:  ((0, 0, 0), (0, 0, 0), (1, 1, 1), (0, 0, 0),
             ((0, 0, 0), (0, 0, 0), (0, 0, 0)),
             ((0, 0, 0), (0, 0, 0), (0, 0, 0))),
        3:  ((r(16), 0, 0), (0, 0, -0.22 * CM), (0.95, 1.0, 0.92), (r(6), 0, 0),
             ((r(20), 0, 0), (r(24), 0, 0), (r(-12), 0, 0)),
             ((r(18), 0, 0), (r(22), 0, 0), (r(-10), 0, 0))),
        7:  ((r(-10), 0, 0), (0, 0, 0.06 * CM), (1.06, 1.12, 0.95), (r(-8), 0, 0),
             ((r(-16), 0, 0), (r(-10), 0, 0), (r(8), 0, 0)),
             ((r(-18), 0, 0), (r(-14), 0, 0), (r(10), 0, 0))),
        11: ((r(12), 0, 0), (0, 0, -0.16 * CM), (0.96, 1.0, 0.94), (r(5), 0, 0),
             ((r(14), 0, 0), (r(16), 0, 0), (r(-8), 0, 0)),
             ((r(12), 0, 0), (r(14), 0, 0), (r(-6), 0, 0))),
        14: ((0, 0, 0), (0, 0, 0), (1, 1, 1), (0, 0, 0),
             ((0, 0, 0), (0, 0, 0), (0, 0, 0)),
             ((0, 0, 0), (0, 0, 0), (0, 0, 0))),
    }
    for fr, (sp, sl, sc, hd, front, back) in keys.items():
        key_euler(spine, fr, sp)
        key_loc(spine, fr, sl)
        key_scale(spine, fr, sc)
        key_euler(head, fr, hd)
        for tag in ("fl", "fr"):
            leg(tag, fr, *front)
        for tag in ("bl", "br"):
            leg(tag, fr, *back)
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "hop")
    return action


def animate_croak(arm):
    action = ensure_action(arm, "croak", CROAK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, CROAK_FRAMES)
    throat = arm.pose.bones["throat"]
    head = arm.pose.bones["head"]
    # Big puff, hold, deflate.
    for fr, sc, nod in (
        (0, 1.00, 0.0),
        (5, 1.85, -4.0),
        (10, 2.15, -6.0),
        (14, 1.90, -3.0),
        (19, 1.00, 0.0),
    ):
        key_scale(throat, fr, (sc, sc * 1.15, sc * 0.95))
        key_euler(head, fr, (math.radians(nod), 0, 0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "croak")
    return action


def animate_tongue(arm):
    action = ensure_action(arm, "tongue", TONGUE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, TONGUE_FRAMES)
    tongue = arm.pose.bones["tongue"]
    # Stretch the tongue forward (along the bone, +Y in bone space ~ toward -Y world).
    for fr, sc, loc_y in (
        (0, 1.0, 0.0),
        (3, 7.5, -2.2 * CM),
        (5, 6.0, -1.6 * CM),
        (7, 1.0, 0.0),
    ):
        key_scale(tongue, fr, (0.7, sc, 0.7))
        key_loc(tongue, fr, (0.0, loc_y, 0.0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "tongue")
    return action


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
    vs.exposure = 0.16
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

    world = bpy.data.worlds.new("FrogPreviewWorld") if "FrogPreviewWorld" not in bpy.data.worlds else bpy.data.worlds["FrogPreviewWorld"]
    world.use_nodes = False
    world.color = (0.95, 0.92, 0.86)
    scene.world = world
    if hasattr(shading, "background_type"):
        shading.background_type = "WORLD"

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 60
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

    add_light("Key", "SUN", (8, -12, 14), 2.0, (1.0, 0.97, 0.92))
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

    view_34 = ((7.2, -10.5, 5.6), (0.0, -0.3, 1.3))
    view_side = ((12.0, 0.3, 4.0), (0.0, 0.0, 1.2))
    PREVIEW_REPO.parent.mkdir(parents=True, exist_ok=True)
    _shot(PREVIEW_REPO, *view_34, "idle", 8)
    shutil.copy2(PREVIEW_REPO, PREVIEW_WORKSPACE)
    _shot(PREVIEW_SIDE, *view_side, "idle", 8)
    shutil.copy2(PREVIEW_SIDE, PREVIEW_REPO_SIDE)
    _shot(PREVIEW_HOP, *view_34, "hop", 7)
    shutil.copy2(PREVIEW_HOP, PREVIEW_REPO_HOP)
    _shot(PREVIEW_CROAK, *view_34, "croak", 10)
    shutil.copy2(PREVIEW_CROAK, PREVIEW_REPO_CROAK)
    # QA
    _shot(Path("/tmp/frog-top.png"), (0.2, -0.4, 18.0), (0.0, 0.0, 0.0), "idle", 8)
    _shot(Path("/tmp/frog-hop-side.png"), *view_side, "hop", 7)
    _shot(Path("/tmp/frog-hop-3.png"), *view_side, "hop", 3)
    _shot(Path("/tmp/frog-hop-11.png"), *view_side, "hop", 11)
    _shot(Path("/tmp/frog-tongue.png"), *view_34, "tongue", 3)

    if arm.animation_data:
        arm.animation_data.action = None
        arm.animation_data.use_nla = True
    for name in ("PreviewCam", "Key", "Fill"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)


def export_glb():
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    arm = bpy.data.objects.get("FrogArmature")
    if arm and arm.animation_data:
        arm.animation_data.action = None
        arm.animation_data.use_nla = True
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


def inspect_glb(path, expected_length):
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
    pos_acc = None
    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
            break
    box = None
    if pos_acc and "min" in pos_acc and "max" in pos_acc:
        mn, mx = pos_acc["min"], pos_acc["max"]
        box = {"min": mn, "max": mx, "size": [mx[i] - mn[i] for i in range(3)]}
    report = {
        "bytes": path.stat().st_size,
        "triangles": tris,
        "animations": anims,
        "skins": len(skins),
        "joints": len(joint_names) if joint_names else 0,
        "bones": joint_names,
        "bbox": box,
        "expected_length": expected_length,
        "materials": [m["name"] for m in gltf.get("materials", [])],
    }
    print("GLB inspect:", json.dumps(report, indent=2))
    if tris == 0 or tris > 3000:
        raise SystemExit(f"triangle count {tris} out of range (1–3000)")
    if path.stat().st_size > 300 * 1024:
        print("WARNING: glb is over 300 KB")
    want = {"idle", "hop", "croak", "tongue"}
    have = set(anims)
    missing = sorted(want - have)
    if missing:
        lower = {a.lower() for a in anims}
        if not (want <= have or want <= lower):
            raise SystemExit(f"missing animations {missing}; have {anims}")
    print("clips ok:", anims)
    print("bone count:", len(joint_names))
    if box:
        length_z = box["size"][2]
        length_max = max(box["size"])
        print(f"length along Z={length_z:.5f} u, longest axis={length_max:.5f} u, expected={expected_length:.5f} u")
        # After Y-up, ground is Y. Feet should sit on Y≈0.
        if box["min"][1] < -0.008:
            print("WARNING: mesh extends well below the ground (Y min =", box["min"][1], ")")
    return report


def main():
    clear_scene()
    mats = {
        "back": set_coat(make_mat("back", BACK, roughness=0.48, metallic=0.0), 0.16, 0.30),
        "flank": set_coat(make_mat("flank", FLANK, roughness=0.50, metallic=0.0), 0.14, 0.32),
        "blotch": make_mat("blotch", BLOTCH, roughness=0.70, metallic=0.0),
        "belly": make_mat("belly", BELLY, roughness=0.72, metallic=0.0),
        "ring": set_coat(make_mat("eyeRing", RING, roughness=0.35, metallic=0.05), 0.25, 0.22),
        "eye": make_mat("eye", EYE, roughness=0.16, metallic=0.0),
        "highlight": make_mat("highlight", HIGHLIGHT, roughness=0.22, metallic=0.0, emission=0.35),
        "mouth": make_mat("mouth", MOUTH, roughness=0.60, metallic=0.0),
        "pad": make_mat("pad", PAD, roughness=0.55, metallic=0.0),
        "throat": make_mat("throat", THROAT, roughness=0.60, metallic=0.0),
        "tongue": make_mat("tongue", TONGUE, roughness=0.45, metallic=0.0),
        "leg": set_coat(make_mat("leg", LEG, roughness=0.52, metallic=0.0), 0.12, 0.32),
    }
    parts, bones = build_meshes(mats)
    for obj in parts:
        print(f"  {obj.name}: {triangle_count(obj)}")
    mesh = join_objects("Frog", parts)
    tris = triangle_count(mesh)
    print(f"joined mesh triangles: {tris}")
    if tris > 3000:
        raise SystemExit(f"too many triangles: {tris}")
    arm = build_armature(bones)
    bind(mesh, arm)
    animate_idle(arm)
    animate_hop(arm)
    animate_croak(arm)
    animate_tongue(arm)
    render_preview(arm)
    export_glb()
    inspect_glb(GLB_PATH, EXPORT_LENGTH)
    print("done")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
