"""Build the Octoventure soft-toon blue-tongue skink and export public/models/skink.glb.

Run:
    /opt/blender/blender -b --python tools/blender/skink.py

A cute toon Tiliqua (western / common blue-tongue, WA): chunky sausage
body, short stubby legs, broad triangular head, short tapering tail,
warm cream-tan with dark-brown cross bands (value contrast for
colour-blind players), pale belly, and a bright blue tongue.

Scale
-----
The in-game octopus is 20 cm = 0.63 u (1 cm = 0.0315 u). This skink is
30 cm including the tail = 0.945 u, already in world units. Hookup uses
visual scale 1.0. The current procedural skink is about 0.82 u (~26 cm),
so this is a modest size-up. The goanna predator is much larger and is
left alone.

Orientation
-----------
Modelled in Blender with +Z up and the face toward -Y; the glTF exporter
(export_yup=True) maps that to +Y up, +Z forward. Origin is on the
ground, between the mid-feet. The belly sits almost on the ground.

Animations
----------
- idle (3 s): breathing, a slow blink, a small head turn
- walk (0.83 s): lizard undulation with diagonal leg pairs; no root motion
- threat (1 s): mouth gapes, blue tongue flares, body puffs
- tongueFlick (0.42 s): a short tongue flick
- bask (3 s): flattened sunning pose
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
GLB_PATH = ROOT / "public" / "models" / "skink.glb"
PREVIEW_REPO = ROOT / "tools" / "blender" / "skink-preview.png"
PREVIEW_REPO_SIDE = ROOT / "tools" / "blender" / "skink-preview-side.png"
PREVIEW_REPO_WALK = ROOT / "tools" / "blender" / "skink-walk.png"
PREVIEW_REPO_THREAT = ROOT / "tools" / "blender" / "skink-threat.png"
PREVIEW_WORKSPACE = Path("/workspace/skink-preview.png")
PREVIEW_SIDE = Path("/workspace/skink-preview-side.png")
PREVIEW_WALK = Path("/workspace/skink-walk.png")
PREVIEW_THREAT = Path("/workspace/skink-threat.png")

CM = 0.0315
LENGTH_CM = 30.0
EXPORT_LENGTH = LENGTH_CM * CM  # 0.945 u

# Warm cream-tan body, dark-brown bands (lightness contrast, not hue),
# pale belly, bright blue tongue. Authored a touch bright so
# Standard+Workbench midtones stay cheerful, not muddy.
BODY = (0xF4 / 255, 0x90 / 255, 0x22 / 255, 1.0)      # #F49022, Workbench midtones read as #D9A050 caramel
BAND = (0x3E / 255, 0x26 / 255, 0x12 / 255, 1.0)      # #3E2612 dark chocolate, a touch darker for Workbench
BELLY = (0xE8 / 255, 0xD0 / 255, 0xA8 / 255, 1.0)     # #E8D0A8 cream, close to the tan so it does not flash white
TONGUE = (0x3A / 255, 0x7A / 255, 0xFF / 255, 1.0)    # #3A7AFF
EYE = (0x14 / 255, 0x14 / 255, 0x16 / 255, 1.0)
HIGHLIGHT = (1.0, 1.0, 1.0, 1.0)
MOUTH = (0xF2 / 255, 0xA0 / 255, 0x90 / 255, 1.0)     # #F2A090 pink gape
LEG = (0xDC / 255, 0x80 / 255, 0x20 / 255, 1.0)       # #DC8020 slightly deeper caramel
CLAW = (0x5C / 255, 0x40 / 255, 0x30 / 255, 1.0)      # #5C4030

FPS = 24
IDLE_FRAMES = 72          # 3.0 s
WALK_FRAMES = 20          # 0.83 s
THREAT_FRAMES = 24        # 1.0 s
FLICK_FRAMES = 10         # 0.42 s
BASK_FRAMES = 72          # 3.0 s


def r(deg):
    return math.radians(deg)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                  bpy.data.actions, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = max(IDLE_FRAMES, WALK_FRAMES, THREAT_FRAMES, FLICK_FRAMES, BASK_FRAMES)
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


def add_uv_sphere(name, radius, segments, rings, loc, scale=None, poles="Z"):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius, segments=segments, ring_count=rings, location=(0.0, 0.0, 0.0)
    )
    obj = bpy.context.active_object
    obj.name = name
    if poles == "Y":
        # Poles on Z, then scale (width, height, length) and rotate so length is +Y.
        if scale:
            obj.scale = (scale[0], scale[2], scale[1])
        obj.rotation_euler = (math.pi / 2.0, 0.0, 0.0)
    elif scale:
        obj.scale = scale
    obj.location = loc
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


def weight_along_axis(obj, stops, axis="y"):
    """Assign blended vertex groups along an axis. stops: [(coord, name), ...] sorted."""
    stops = sorted(stops, key=lambda s: s[0])
    existing = {vg.name: vg for vg in obj.vertex_groups}
    groups = {}
    for _c, name in stops:
        groups[name] = existing.get(name) or obj.vertex_groups.new(name=name)
    idx = {"x": 0, "y": 1, "z": 2}[axis]
    for vi, v in enumerate(obj.data.vertices):
        p = v.co[idx]
        if p <= stops[0][0]:
            groups[stops[0][1]].add([vi], 1.0, "REPLACE")
            continue
        if p >= stops[-1][0]:
            groups[stops[-1][1]].add([vi], 1.0, "REPLACE")
            continue
        for i in range(len(stops) - 1):
            a, na = stops[i]
            b, nb = stops[i + 1]
            if a <= p <= b:
                t = 0.0 if b - a < 1e-9 else (p - a) / (b - a)
                if t < 0.001:
                    groups[na].add([vi], 1.0, "REPLACE")
                elif t > 0.999:
                    groups[nb].add([vi], 1.0, "REPLACE")
                else:
                    groups[na].add([vi], 1.0 - t, "REPLACE")
                    groups[nb].add([vi], t, "REPLACE")
                break


def ensure_slot(obj, mat):
    mats = obj.data.materials
    for i, m in enumerate(mats):
        if m == mat:
            return i
    mats.append(mat)
    return len(mats) - 1


def smooth_mesh(obj, iterations=8, factor=0.55):
    """Relax boolean creases without changing the triangle count."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new("Smooth", "SMOOTH")
    mod.factor = factor
    mod.iterations = iterations
    bpy.ops.object.modifier_apply(modifier=mod.name)
    shade_smooth(obj)


def paint_bands(obj, mats, y0, y1, n_dark, belly_nz=-0.70, belly_z_max=0.95 * 0.0315):
    """Paint flush dark-brown cross bands, as wide as the pale gaps, wrapping the flanks.

    Underside faces get a cream belly so there is no separate white plate.
    """
    band_i = ensure_slot(obj, mats["band"])
    belly_i = ensure_slot(obj, mats["belly"])
    body_i = ensure_slot(obj, mats["body"])
    span = y1 - y0
    if span <= 1e-9 or n_dark < 1:
        return
    period = span / float(n_dark)
    half = period * 0.5
    for poly in obj.data.polygons:
        c = poly.center
        n = poly.normal
        if n.z < belly_nz and c.z < belly_z_max:
            poly.material_index = belly_i
            continue
        if c.y < y0 or c.y > y1:
            poly.material_index = body_i
            continue
        pos = (c.y - y0) % period
        poly.material_index = band_i if pos < half else body_i


def paint_eye_stripes(obj, mats, head_c, head_s):
    """A short dark streak immediately behind each eye."""
    band_i = ensure_slot(obj, mats["band"])
    eye_y = head_c.y + head_s.y * (-0.28)
    y0 = eye_y - 0.05 * CM
    y1 = eye_y + 1.55 * CM
    z_min = head_c.z + 0.10 * CM
    z_max = head_c.z + head_s.z * 0.72
    x_min = head_s.x * 0.52
    for poly in obj.data.polygons:
        c = poly.center
        n = poly.normal
        if c.y < y0 or c.y > y1:
            continue
        if c.z < z_min or c.z > z_max:
            continue
        if abs(c.x) < x_min:
            continue
        # Side-facing only, so it does not spill onto the crown or cheek.
        if abs(n.x) < 0.22:
            continue
        poly.material_index = band_i


def wedge_head(obj, y_tip, y_back, x_tip=0.78, x_back=1.10, z_top=None, flatten=0.78):
    """Taper the snout and flatten the crown so the head reads as a wedge, not a blob."""
    span = y_back - y_tip
    if span <= 1e-9:
        return
    for v in obj.data.vertices:
        y = v.co.y
        if y < y_tip or y > y_back:
            continue
        t = (y - y_tip) / span  # 0 at the tip, 1 at the back of the skull
        v.co.x *= x_tip + (x_back - x_tip) * t
        if z_top is not None and v.co.z > z_top:
            v.co.z = z_top + (v.co.z - z_top) * flatten
    obj.data.update()


def add_leg(parts, mats, tag, joints, radii, parent_bone, names, n_toes=4):
    """One smooth tapered skinned tube plus short attached toes.

    joints: hip, knee, ankle, toe. names: upper, lower, foot.
    """
    hip, knee, ankle, toe = [Vector(p) for p in joints]
    r_hip, r_knee, r_ankle, r_toe = radii
    inward = Vector((-1.0 if hip.x > 0 else 1.0, 0.0, 0.15)).normalized()
    hip_in = hip + inward * (r_hip * 0.45)
    mid_lower = knee.lerp(ankle, 0.5)
    points = [hip_in, hip, knee, mid_lower, ankle, toe]
    rads = [
        r_hip * 1.05,
        r_hip * 1.00,
        r_knee * 1.02,
        (r_knee + r_ankle) * 0.52,
        r_ankle * 1.00,
        r_toe * 0.95,
    ]
    tube = add_tapered_tube(f"{tag}_leg", points, rads, verts=8, extra_rings=0, cap=True)
    set_material(tube, mats["leg"])
    assign_chain_weights(tube, [hip, knee, ankle, toe], names, parent_bone=parent_bone)
    parts.append(tube)

    fwd = toe - ankle
    if fwd.length < 1e-9:
        fwd = Vector((0.0, -1.0, 0.0))
    fwd.normalize()
    fwd_flat = Vector((fwd.x, fwd.y, 0.0))
    if fwd_flat.length < 1e-6:
        fwd_flat = Vector((0.0, -1.0, 0.0))
    fwd_flat.normalize()
    side = Vector((1.0 if hip.x > 0 else -1.0, 0.0, 0.0))
    origin = toe - fwd_flat * (0.12 * CM)
    origin.z = max(origin.z, r_toe * 0.85)
    toe_len = 0.55 * CM
    if n_toes == 3:
        spreads, reaches = (-0.85, 0.0, 0.85), (0.90, 1.12, 0.90)
    else:
        spreads, reaches = (-1.15, -0.38, 0.38, 1.15), (0.88, 1.10, 1.10, 0.88)
    pad_r = 0.16 * CM
    for i, (sp, reach) in enumerate(zip(spreads, reaches)):
        tip = Vector((
            origin.x + side.x * sp * pad_r * 1.6 + fwd_flat.x * reach * toe_len,
            origin.y + fwd_flat.y * reach * toe_len,
            pad_r * 0.90,
        ))
        start = origin.lerp(tip, 0.08)
        start.z = max(start.z, r_toe * 0.5)
        digit = add_tapered_tube(
            f"{tag}_toe{i}", [start, tip],
            [r_toe * 0.55, pad_r * 0.65],
            verts=6, extra_rings=0, cap=True,
        )
        set_material(digit, mats["leg"])
        assign_group(digit, names[2])
        parts.append(digit)
        pad = add_uv_sphere(
            f"{tag}_pad{i}", pad_r, 6, 3,
            Vector((tip.x, tip.y, pad_r * 0.70)),
            scale=Vector((1.15, 1.20, 0.65)),
        )
        set_material(pad, mats["claw"])
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

    # Snout at y=-11.4, vent at y=+8.2 (SVL ~19.6 cm). Tail is shorter and
    # fatter, about half the body length: tip at y=+18.2 (10 cm). Total ~29.6 cm.
    # Low-slung: the belly is the underside of the body, not a separate plate.
    body_c = Vector((0.0, 1.0, 2.20)) * CM
    body_s = Vector((3.45, 7.20, 2.10)) * CM
    # Broad, slightly triangular wedge head, wider than the neck, flatter top.
    head_c = Vector((0.0, -7.6, 2.15)) * CM
    head_s = Vector((4.15, 3.10, 1.58)) * CM
    snout_c = Vector((0.0, -10.0, 1.85)) * CM
    snout_s = Vector((2.20, 1.90, 1.08)) * CM
    neck_c = Vector((0.0, -4.8, 2.15)) * CM
    neck_s = Vector((3.05, 3.10, 1.90)) * CM

    body = add_uv_sphere("body", 1.0, 20, 16, body_c, scale=body_s, poles="Y")
    set_material(body, mats["body"])
    neck = add_uv_sphere("neck", 1.0, 16, 12, neck_c, scale=neck_s, poles="Y")
    set_material(neck, mats["body"])
    head = add_uv_sphere("head", 1.0, 18, 14, head_c, scale=head_s, poles="Y")
    set_material(head, mats["body"])
    snout = add_uv_sphere("snout", 1.0, 14, 10, snout_c, scale=snout_s, poles="Y")
    set_material(snout, mats["body"])

    # Tail starts well inside the rump so a later union has no collar seam.
    tail_pts = [
        Vector((0.0, 6.4, 2.05)) * CM,
        Vector((0.0, 9.2, 1.90)) * CM,
        Vector((0.0, 11.6, 1.58)) * CM,
        Vector((0.0, 13.8, 1.18)) * CM,
        Vector((0.0, 16.0, 0.78)) * CM,
        Vector((0.0, 18.2, 0.45)) * CM,
    ]
    tail_r = [2.45 * CM, 1.95 * CM, 1.50 * CM, 1.08 * CM, 0.72 * CM, 0.38 * CM]
    tail = add_tapered_tube("tail", tail_pts, tail_r, verts=10, extra_rings=1, cap=True)
    set_material(tail, mats["body"])

    body = boolean_union(body, [neck, head, snout, tail])
    body.name = "body"
    set_material(body, mats["body"])
    # Sharpen the wedge after the union, then relax the boolean creases.
    wedge_head(body, y_tip=-11.6 * CM, y_back=-5.2 * CM,
               x_tip=0.80, x_back=1.12, z_top=head_c.z + 0.35 * CM, flatten=0.70)
    smooth_mesh(body, iterations=7, factor=0.50)
    weight_along_axis(body, [
        (-11.0 * CM, "head"),
        (-7.4 * CM, "head"),
        (-5.0 * CM, "neck"),
        (-3.0 * CM, "spine1"),
        (1.2 * CM, "spine2"),
        (6.8 * CM, "spine3"),
        (9.2 * CM, "tail1"),
        (11.6 * CM, "tail2"),
        (13.8 * CM, "tail3"),
        (16.0 * CM, "tail4"),
        (18.2 * CM, "tail5"),
    ], "y")
    # One run of bands from the nape all the way down the tail: 8 on the
    # body + 5 on the tail, equal dark/pale width, wrapping the flanks.
    paint_bands(body, mats, y0=-5.4 * CM, y1=17.8 * CM, n_dark=14,
                belly_nz=-0.72, belly_z_max=0.95 * CM)
    paint_eye_stripes(body, mats, head_c, head_s)
    parts.append(body)

    # Gentle smile on the snout.
    smile_dirs = [
        (-0.42, -0.80, -0.30),
        (-0.22, -0.92, -0.42),
        (0.00, -0.97, -0.50),
        (0.22, -0.92, -0.42),
        (0.42, -0.80, -0.30),
    ]
    smile_pts = [on_ellipsoid(snout_c, snout_s, d, 1.01) for d in smile_dirs]
    smile = add_tapered_tube(
        "smile", smile_pts,
        [0.034 * CM, 0.040 * CM, 0.044 * CM, 0.040 * CM, 0.034 * CM],
        verts=5, extra_rings=0, cap=True,
    )
    set_material(smile, mats["band"])
    assign_group(smile, "head")
    parts.append(smile)

    # Lower jaw and a pink mouth interior, tucked in at rest, visible on the gape.
    jaw_c = Vector((0.0, -9.85, 1.38)) * CM
    jaw_s = Vector((1.90, 1.50, 0.42)) * CM
    jaw = add_uv_sphere("jaw", 1.0, 12, 8, jaw_c, scale=jaw_s, poles="Y")
    set_material(jaw, mats["body"])
    assign_group(jaw, "jaw")
    parts.append(jaw)
    mouth = add_uv_sphere(
        "mouth", 1.0, 10, 6,
        jaw_c + Vector((0.0, 0.10, 0.22)) * CM,
        scale=Vector((1.45, 1.10, 0.26)) * CM,
        poles="Y",
    )
    set_material(mouth, mats["mouth"])
    assign_group(mouth, "jaw")
    parts.append(mouth)

    # Fat, rounded, slightly notched blue tongue. At rest it sits in the
    # mouth; the threat clip slides about half a head-length out.
    tongue_base = Vector((0.0, -9.2, 1.55)) * CM
    tongue_mid = Vector((0.0, -9.9, 1.50)) * CM
    tongue_end = Vector((0.0, -10.5, 1.42)) * CM
    tongue = add_tapered_tube(
        "tongue",
        [tongue_base, tongue_mid, tongue_end],
        [0.42 * CM, 0.55 * CM, 0.48 * CM],
        verts=10, extra_rings=1, cap=True,
    )
    mid_z = tongue_mid.z
    for v in tongue.data.vertices:
        # Keep real thickness and a slight downward curve toward the tip.
        v.co.z = mid_z + (v.co.z - mid_z) * 0.80
        v.co.x *= 1.22
        # Slight notch: pull the very tip centre back, leaving two rounded corners.
        along = (tongue_end.y - v.co.y)  # more negative y = closer to tip, along is negative
        if v.co.y < tongue_end.y + 0.28 * CM and abs(v.co.x) < 0.16 * CM:
            v.co.y += 0.16 * CM
            v.co.z -= 0.04 * CM
        # Gentle droop toward the tip.
        fade = max(0.0, min(1.0, (tongue_base.y - v.co.y) / (tongue_base.y - tongue_end.y + 1e-9)))
        v.co.z -= 0.10 * CM * fade * fade
    tongue.data.update()
    shade_smooth(tongue)
    set_material(tongue, mats["tongue"])
    vg_a = tongue.vertex_groups.new(name="tongue")
    vg_b = tongue.vertex_groups.new(name="tongueTip")
    mid_y = tongue_mid.y
    for i, v in enumerate(tongue.data.vertices):
        if v.co.y > mid_y + 0.05 * CM:
            vg_a.add([i], 1.0, "REPLACE")
        elif v.co.y < mid_y - 0.05 * CM:
            vg_b.add([i], 1.0, "REPLACE")
        else:
            vg_a.add([i], 0.5, "REPLACE")
            vg_b.add([i], 0.5, "REPLACE")
    parts.append(tongue)
    # Single rounded cap, slightly flattened, so the tip is a fat paddle with a notch, not two sausages.
    tip_cap = add_uv_sphere(
        "tongue_cap", 0.42 * CM, 10, 6, tongue_end + Vector((0.0, -0.04, -0.04)) * CM,
        scale=Vector((1.35, 1.05, 0.72)),
    )
    # Cut a shallow centre notch in the cap too.
    for v in tip_cap.data.vertices:
        if v.co.y < tongue_end.y - 0.05 * CM and abs(v.co.x) < 0.14 * CM:
            v.co.y += 0.14 * CM
    tip_cap.data.update()
    shade_smooth(tip_cap)
    set_material(tip_cap, mats["tongue"])
    assign_group(tip_cap, "tongueTip")
    parts.append(tip_cap)

    # Smaller eyes set on the sides of the head, not bulging on stalks.
    eye_bones = {}
    for side, name in ((1, "eye_L"), (-1, "eye_R")):
        loc = on_ellipsoid(head_c, head_s, (side * 0.90, -0.28, 0.18), 0.99)
        eye_r = 0.34 * CM
        look = Vector((side * 0.85, -0.45, 0.06)).normalized()
        eyeball = add_uv_sphere(name, eye_r, 12, 8, loc)
        set_material(eyeball, mats["eye"])
        assign_group(eyeball, name)
        parts.append(eyeball)
        hl_dir = (look + Vector((0.0, 0.0, 0.50))).normalized()
        hl = add_uv_sphere(name + "_hl", 0.09 * CM, 6, 3, loc + hl_dir * (eye_r * 0.88))
        set_material(hl, mats["highlight"])
        assign_group(hl, name)
        parts.append(hl)
        eye_bones[name] = (loc, loc + look * (0.18 * CM))

    # Short, sturdy, sprawling legs. Front feet plant ahead of the chest,
    # not tucked underneath.
    front_r = (0.78 * CM, 0.62 * CM, 0.42 * CM, 0.28 * CM)
    back_r = (0.90 * CM, 0.70 * CM, 0.46 * CM, 0.30 * CM)
    for side, tag in ((1, "fl"), (-1, "fr")):
        s = float(side)
        joints = [
            Vector((s * 2.55, -4.4, 1.85)) * CM,
            Vector((s * 3.45, -5.4, 1.00)) * CM,
            Vector((s * 3.30, -6.3, 0.32)) * CM,
            Vector((s * 3.15, -7.1, 0.12)) * CM,
        ]
        names = [f"{tag}_upper", f"{tag}_lower", f"{tag}_foot"]
        bones.extend(add_leg(parts, mats, tag, joints, front_r, "spine1", names, n_toes=4))
    for side, tag in ((1, "bl"), (-1, "br")):
        s = float(side)
        joints = [
            Vector((s * 2.70, 5.0, 1.90)) * CM,
            Vector((s * 3.55, 6.0, 1.05)) * CM,
            Vector((s * 3.35, 5.2, 0.32)) * CM,
            Vector((s * 3.15, 4.3, 0.12)) * CM,
        ]
        names = [f"{tag}_upper", f"{tag}_lower", f"{tag}_foot"]
        bones.extend(add_leg(parts, mats, tag, joints, back_r, "spine3", names, n_toes=4))

    # Core bones. Spine points toward the tail (+Y).
    core = [
        ("root", None, Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.5)) * CM),
        ("spine1", "root", Vector((0.0, -4.2, 2.20)) * CM, Vector((0.0, -1.0, 2.20)) * CM),
        ("spine2", "spine1", Vector((0.0, -1.0, 2.20)) * CM, Vector((0.0, 3.4, 2.18)) * CM),
        ("spine3", "spine2", Vector((0.0, 3.4, 2.18)) * CM, Vector((0.0, 7.6, 2.05)) * CM),
        ("neck", "spine1", Vector((0.0, -5.6, 2.20)) * CM, Vector((0.0, -4.2, 2.20)) * CM),
        ("head", "neck", Vector((0.0, -7.2, 2.20)) * CM, Vector((0.0, -10.6, 2.00)) * CM),
        ("jaw", "head", Vector((0.0, -9.2, 1.50)) * CM, Vector((0.0, -11.0, 1.15)) * CM),
        ("tongue", "head", tongue_base, tongue_mid),
        ("tongueTip", "tongue", tongue_mid, tongue_end),
        ("eye_L", "head", eye_bones["eye_L"][0], eye_bones["eye_L"][1]),
        ("eye_R", "head", eye_bones["eye_R"][0], eye_bones["eye_R"][1]),
        ("tail1", "spine3", tail_pts[0], tail_pts[1]),
        ("tail2", "tail1", tail_pts[1], tail_pts[2]),
        ("tail3", "tail2", tail_pts[2], tail_pts[3]),
        ("tail4", "tail3", tail_pts[3], tail_pts[4]),
        ("tail5", "tail4", tail_pts[4], tail_pts[5]),
    ]
    # neck is listed after spine1 but should be parented to spine1; it's already in core.
    # Leg bones were appended earlier. Prepend core.
    bones = core + bones
    return parts, bones


def zero_pose(arm):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def animate_idle(arm):
    action = ensure_action(arm, "idle", IDLE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, IDLE_FRAMES)
    spine2 = arm.pose.bones["spine2"]
    spine3 = arm.pose.bones["spine3"]
    neck = arm.pose.bones["neck"]
    head = arm.pose.bones["head"]
    # Slow breath and a gentle head turn.
    for fr, breath, turn in (
        (0, 1.00, 0.0),
        (18, 1.03, 6.0),
        (36, 0.99, 2.0),
        (54, 1.035, -7.0),
        (72, 1.00, 0.0),
    ):
        key_scale(spine2, fr, (1.0 + (breath - 1) * 0.4, 1.0, breath))
        key_scale(spine3, fr, (1.0 + (breath - 1) * 0.3, 1.0, breath))
        key_euler(neck, fr, (0, 0, r(turn * 0.4)))
        key_euler(head, fr, (r(-2.0 if breath > 1 else 1.0), 0, r(turn)))
    for name in ("eye_L", "eye_R"):
        pb = arm.pose.bones[name]
        for fr, sc in ((0, 1.0), (26, 1.0), (28, 0.15), (30, 1.0),
                        (58, 1.0), (60, 0.15), (62, 1.0), (72, 1.0)):
            key_scale(pb, fr, (1.0, sc, 1.0) if sc < 1 else (1, 1, 1), interpolation="LINEAR")
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "idle")
    return action


def animate_walk(arm):
    """Lizard walk: diagonal pairs, body undulation, no root translation."""
    action = ensure_action(arm, "walk", WALK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, WALK_FRAMES)

    def bone(name):
        return arm.pose.bones[name]

    # Signs: spine bones point +Y, so Euler Z is a left/right bend.
    # Leg bones point down the limb; Euler X is the main swing. Modest
    # angles only — we inspect mid-stride and retune.
    # Frame 0 / 20: FL+BR forward, FR+BL back, body yaw 0 going left
    # Frame 10: opposite pair, body yaw the other way
    keys = {
        # fr: (spine1_z, spine2_z, spine3_z, neck_z, head_z, tail1_z, tail3_z,
        #      fl, fr, bl, br) where each leg is (upper_x, lower_x, foot_x) deg
        0:  (6, 12, 8, -4, -8, -8, -14,
             (22, 12, -10), (-18, 10, 6), (-18, 10, 6), (22, 12, -10)),
        5:  (8, 14, 10, -5, -10, -10, -16,
             (26, 8, -12), (-22, 14, 8), (-22, 14, 8), (26, 8, -12)),
        10: (-6, -12, -8, 4, 8, 8, 14,
             (-18, 10, 6), (22, 12, -10), (22, 12, -10), (-18, 10, 6)),
        15: (-8, -14, -10, 5, 10, 10, 16,
             (-22, 14, 8), (26, 8, -12), (26, 8, -12), (-22, 14, 8)),
        20: (6, 12, 8, -4, -8, -8, -14,
             (22, 12, -10), (-18, 10, 6), (-18, 10, 6), (22, 12, -10)),
    }
    for fr, (s1, s2, s3, nk, hd, t1, t3, fl, frl, bl, br) in keys.items():
        key_euler(bone("spine1"), fr, (0, 0, r(s1)))
        key_euler(bone("spine2"), fr, (0, 0, r(s2)))
        key_euler(bone("spine3"), fr, (0, 0, r(s3)))
        key_euler(bone("neck"), fr, (0, 0, r(nk)))
        key_euler(bone("head"), fr, (0, 0, r(hd)))
        key_euler(bone("tail1"), fr, (0, 0, r(t1)))
        key_euler(bone("tail2"), fr, (0, 0, r(t1 * 0.8)))
        key_euler(bone("tail3"), fr, (0, 0, r(t3)))
        key_euler(bone("tail4"), fr, (0, 0, r(t3 * 0.8)))
        for tag, pose in (("fl", fl), ("fr", frl), ("bl", bl), ("br", br)):
            key_euler(bone(f"{tag}_upper"), fr, (r(pose[0]), 0, 0))
            key_euler(bone(f"{tag}_lower"), fr, (r(pose[1]), 0, 0))
            key_euler(bone(f"{tag}_foot"), fr, (r(pose[2]), 0, 0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "walk")
    return action


def animate_threat(arm):
    action = ensure_action(arm, "threat", THREAT_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, THREAT_FRAMES)
    jaw = arm.pose.bones["jaw"]
    head = arm.pose.bones["head"]
    tongue = arm.pose.bones["tongue"]
    tip = arm.pose.bones["tongueTip"]
    spine2 = arm.pose.bones["spine2"]
    spine3 = arm.pose.bones["spine3"]
    # Build, hold, settle. Tongue flares wide and forward.
    for fr, gape, puff, lift, ext, wide in (
        (0,  0,  1.00, 0,  0.0, 1.00),
        (6,  26, 1.06, 8,  0.55, 1.10),
        (12, 48, 1.08, 12, 1.00, 1.18),
        (18, 42, 1.06, 10, 0.90, 1.14),
        (24, 0,  1.00, 0,  0.0, 1.00),
    ):
        # Jaw bone points toward the snout; +X opens the mouth.
        key_euler(jaw, fr, (r(gape), 0, 0))
        key_euler(head, fr, (r(-lift * 0.4), 0, 0))
        key_scale(spine2, fr, (puff, 1.0, puff))
        key_scale(spine3, fr, (puff * 0.98, 1.0, puff))
        # Slide a fat tongue about half a head-length out; do not scale it huge.
        # +Z on this bone is slightly down in the gape so a little +Z droops it.
        key_loc(tongue, fr, (0.0, ext * 1.7 * CM, 0.08 * CM * ext))
        key_scale(tongue, fr, (wide, 1.0 + ext * 0.08, 1.0))
        key_loc(tip, fr, (0.0, ext * 0.35 * CM, 0.04 * CM * ext))
        key_scale(tip, fr, (wide, 1.0, 1.0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "threat")
    return action


def animate_flick(arm):
    action = ensure_action(arm, "tongueFlick", FLICK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, FLICK_FRAMES)
    jaw = arm.pose.bones["jaw"]
    tongue = arm.pose.bones["tongue"]
    tip = arm.pose.bones["tongueTip"]
    for fr, gape, ext, wide in (
        (0, 0, 0.0, 1.0),
        (3, 12, 0.50, 1.08),
        (5, 18, 0.80, 1.12),
        (7, 10, 0.40, 1.06),
        (10, 0, 0.0, 1.0),
    ):
        key_euler(jaw, fr, (r(gape), 0, 0))
        key_loc(tongue, fr, (0.0, ext * 1.3 * CM, 0.05 * CM * ext))
        key_scale(tongue, fr, (wide, 1.0 + ext * 0.06, 1.0))
        key_loc(tip, fr, (0.0, ext * 0.25 * CM, 0.02 * CM * ext))
        key_scale(tip, fr, (wide, 1.0, 1.0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "tongueFlick")
    return action


def animate_bask(arm):
    action = ensure_action(arm, "bask", BASK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, BASK_FRAMES)
    spine1 = arm.pose.bones["spine1"]
    spine2 = arm.pose.bones["spine2"]
    spine3 = arm.pose.bones["spine3"]
    head = arm.pose.bones["head"]
    neck = arm.pose.bones["neck"]
    # Flattened sunning pose, head turned, a little breath.
    for fr, breath, turn in (
        (0, 1.00, 16.0),
        (24, 1.025, 18.0),
        (48, 0.995, 14.0),
        (72, 1.00, 16.0),
    ):
        flat = (1.10, 1.0, 0.82 * breath)
        key_scale(spine1, fr, (1.08, 1.0, 0.88 * breath))
        key_scale(spine2, fr, flat)
        key_scale(spine3, fr, (1.08, 1.0, 0.85 * breath))
        key_euler(neck, fr, (r(6), 0, r(turn * 0.4)))
        key_euler(head, fr, (r(8), 0, r(turn)))
        key_euler(spine1, fr, (r(4), 0, 0))
    for tag, out in (("fl", 8), ("fr", -8), ("bl", 10), ("br", -10)):
        pb = arm.pose.bones[f"{tag}_upper"]
        for fr in (0, 72):
            key_euler(pb, fr, (r(6), 0, r(out)))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "bask")
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

    world = bpy.data.worlds.new("SkinkPreviewWorld") if "SkinkPreviewWorld" not in bpy.data.worlds else bpy.data.worlds["SkinkPreviewWorld"]
    world.use_nodes = False
    world.color = (0.95, 0.92, 0.86)
    scene.world = world
    if hasattr(shading, "background_type"):
        shading.background_type = "WORLD"

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 55
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

    add_light("Key", "SUN", (14, -18, 16), 2.0, (1.0, 0.97, 0.92))
    add_light("Fill", "AREA", (-12, -8, 10), 50.0, (0.85, 0.9, 1.0))

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

    # Look at the chest, a little toward the head. The skink is ~30 cm long.
    view_34 = ((26.0, -34.0, 16.0), (0.0, -1.5, 2.2))
    view_side = ((46.0, -1.0, 11.0), (0.0, -1.0, 2.0))
    PREVIEW_REPO.parent.mkdir(parents=True, exist_ok=True)
    _shot(PREVIEW_REPO, *view_34, "idle", 8)
    shutil.copy2(PREVIEW_REPO, PREVIEW_WORKSPACE)
    _shot(PREVIEW_SIDE, *view_side, "idle", 8)
    shutil.copy2(PREVIEW_SIDE, PREVIEW_REPO_SIDE)
    _shot(PREVIEW_WALK, *view_34, "walk", 5)
    shutil.copy2(PREVIEW_WALK, PREVIEW_REPO_WALK)
    _shot(PREVIEW_THREAT, *view_34, "threat", 12)
    shutil.copy2(PREVIEW_THREAT, PREVIEW_REPO_THREAT)
    # QA
    _shot(Path("/tmp/skink-top.png"), (0.5, 1.0, 48.0), (0.0, 1.0, 0.0), "idle", 8)
    _shot(Path("/tmp/skink-walk-side.png"), *view_side, "walk", 5)
    _shot(Path("/tmp/skink-walk-10.png"), *view_34, "walk", 10)
    _shot(Path("/tmp/skink-bask.png"), *view_34, "bask", 8)
    _shot(Path("/tmp/skink-flick.png"), *view_34, "tongueFlick", 5)
    _shot(Path("/tmp/skink-threat-side.png"), *view_side, "threat", 12)

    if arm.animation_data:
        arm.animation_data.action = None
        arm.animation_data.use_nla = True
    for name in ("PreviewCam", "Key", "Fill"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)


def export_glb():
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    arm = bpy.data.objects.get("SkinkArmature")
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
    if tris == 0 or tris > 4000:
        raise SystemExit(f"triangle count {tris} out of range (1–4000)")
    if path.stat().st_size > 350 * 1024:
        print("WARNING: glb is over 350 KB")
    want = {"idle", "walk", "threat", "tongueFlick", "bask"}
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
        if box["min"][1] < -0.012:
            print("WARNING: mesh extends well below the ground (Y min =", box["min"][1], ")")
    return report


def main():
    clear_scene()
    mats = {
        "body": set_coat(make_mat("body", BODY, roughness=0.52, metallic=0.0), 0.12, 0.35),
        "band": make_mat("band", BAND, roughness=0.70, metallic=0.0),
        "belly": make_mat("belly", BELLY, roughness=0.72, metallic=0.0),
        "tongue": set_coat(make_mat("tongue", TONGUE, roughness=0.35, metallic=0.0), 0.18, 0.22),
        "eye": make_mat("eye", EYE, roughness=0.16, metallic=0.0),
        "highlight": make_mat("highlight", HIGHLIGHT, roughness=0.22, metallic=0.0, emission=0.35),
        "mouth": make_mat("mouth", MOUTH, roughness=0.60, metallic=0.0),
        "leg": set_coat(make_mat("leg", LEG, roughness=0.55, metallic=0.0), 0.10, 0.35),
        "claw": make_mat("claw", CLAW, roughness=0.60, metallic=0.0),
    }
    parts, bones = build_meshes(mats)
    for obj in parts:
        print(f"  {obj.name}: {triangle_count(obj)}")
    mesh = join_objects("Skink", parts)
    # Assign any unweighted verts so the exporter does not invent a neutral_bone.
    fb = mesh.vertex_groups.get("spine2") or mesh.vertex_groups.new(name="spine2")
    missing = [i for i, v in enumerate(mesh.data.vertices) if not v.groups]
    if missing:
        fb.add(missing, 1.0, "REPLACE")
        print(f"filled {len(missing)} unweighted verts")
    tris = triangle_count(mesh)
    print(f"joined mesh triangles: {tris}")
    if tris > 4000:
        raise SystemExit(f"too many triangles: {tris}")
    arm = build_armature(bones)
    arm.name = "SkinkArmature"
    bind(mesh, arm)
    animate_idle(arm)
    animate_walk(arm)
    animate_threat(arm)
    animate_flick(arm)
    animate_bask(arm)
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
