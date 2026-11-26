"""Build the Octoventure soft-toon superb fairy-wren and export public/models/wren.glb.

Run:
    /opt/blender/blender -b --python tools/blender/wren.py

A cute toon Malurus cyaneus (superb fairy-wren) in breeding-male colours:
bright sky-blue crown and ear patches, a black eye stripe and nape,
a deep blue-black throat, brown-grey back and wings, a pale cream belly
and a long cocked blue-grey tail. Value contrast (light blue vs mid brown
vs dark mask) so the pattern reads for a colour-blind player.

Scale
-----
The in-game octopus is 20 cm = 0.63 u (1 cm = 0.0315 u). This wren is
about 14 cm including the cocked tail (~0.44 u), already in world units.
Hookup uses visual scale 1.0.

Orientation
-----------
Modelled in Blender with +Z up and the face toward -Y; the glTF exporter
(export_yup=True) maps that to +Y up, +Z forward. Origin is on the
ground, between the feet.

Animations
----------
- idle (2.5 s): head tilts, tail flicks
- hop (0.33 s): a little bounce pose; root motion is NOT baked; +Z forward
- fly (0.42 s): a wingbeat loop with the wings fully spread
- peck (0.50 s): a ground peck
- song (1.00 s): beak open, throat puff, tail up

Female / eclipse retint (same material names, for hookup):
  crown, ear, throat, nape -> brown-grey #A09070
  mask -> rusty orange #D07838 around the eye
  tail stays blue-grey; back, wing, belly stay as they are.
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
GLB_PATH = ROOT / "public" / "models" / "wren.glb"
PREVIEW_REPO = ROOT / "tools" / "blender" / "wren-preview.png"
PREVIEW_REPO_SIDE = ROOT / "tools" / "blender" / "wren-preview-side.png"
PREVIEW_REPO_FLY = ROOT / "tools" / "blender" / "wren-fly.png"
PREVIEW_REPO_SONG = ROOT / "tools" / "blender" / "wren-song.png"
PREVIEW_WORKSPACE = Path("/workspace/wren-preview.png")
PREVIEW_SIDE = Path("/workspace/wren-preview-side.png")
PREVIEW_FLY = Path("/workspace/wren-fly.png")
PREVIEW_SONG = Path("/workspace/wren-song.png")

CM = 0.0315
LENGTH_CM = 14.0
EXPORT_LENGTH = LENGTH_CM * CM  # 0.441 u

# Authored a touch bright/saturated so Workbench midtones stay vivid.
CROWN = (0x6A / 255, 0xDC / 255, 0xFF / 255, 1.0)      # #6ADCFF light sky-blue
EAR = (0x5C / 255, 0xD4 / 255, 0xFF / 255, 1.0)        # #5CD4FF
MASK = (0x16 / 255, 0x14 / 255, 0x16 / 255, 1.0)       # #161416 black stripe
NAPE = (0x18 / 255, 0x16 / 255, 0x18 / 255, 1.0)       # #181618
THROAT = (0x14 / 255, 0x2C / 255, 0x58 / 255, 1.0)     # #142C58 deep blue-black
BACK = (0xB0 / 255, 0x84 / 255, 0x52 / 255, 1.0)       # #B08452 mid warm brown-grey
WING = (0x8A / 255, 0x6C / 255, 0x4C / 255, 1.0)       # #8A6C4C slightly darker wing
BELLY = (0xF2 / 255, 0xEA / 255, 0xD8 / 255, 1.0)      # #F2EAD8 pale cream-grey
TAIL = (0x5A / 255, 0x86 / 255, 0xB0 / 255, 1.0)       # #5A86B0 mid blue-grey
BEAK = (0x2C / 255, 0x24 / 255, 0x1C / 255, 1.0)       # #2C241C
EYE = (0x14 / 255, 0x14 / 255, 0x16 / 255, 1.0)
HIGHLIGHT = (1.0, 1.0, 1.0, 1.0)
LEG = (0x32 / 255, 0x28 / 255, 0x20 / 255, 1.0)        # #322820 dark twiggy legs

FPS = 24
IDLE_FRAMES = 60          # 2.5 s
HOP_FRAMES = 8            # 0.33 s
FLY_FRAMES = 10           # 0.42 s
PECK_FRAMES = 12          # 0.50 s
SONG_FRAMES = 24          # 1.00 s


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                  bpy.data.actions, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = max(IDLE_FRAMES, HOP_FRAMES, FLY_FRAMES, PECK_FRAMES, SONG_FRAMES)
    scene.render.fps = FPS
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

def r(deg):
    return math.radians(deg)


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
    data = bpy.data.armatures.new("WrenArmature")
    data.display_type = "OCTAHEDRAL"
    arm = bpy.data.objects.new("WrenArmature", data)
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


def snap_to_mesh(obj, point, inset=0.0):
    """Closest point on obj, then step inward along the surface normal."""
    ok, loc, n, _idx = obj.closest_point_on_mesh(Vector(point))
    if not ok:
        return Vector(point), Vector((0.0, 0.0, 1.0))
    n = Vector(n)
    if n.length < 1e-9:
        n = Vector((0.0, 0.0, 1.0))
    n.normalize()
    return Vector(loc) - n * inset, n



def paint_wren_body(obj, mats, body_c):
    """Belly on the underside; leave crown, throat and nape slots alone."""
    belly_i = ensure_slot(obj, mats["belly"])
    back_i = ensure_slot(obj, mats["back"])
    keep = set()
    for key in ("crown", "throat", "nape"):
        if mats[key] in obj.data.materials[:]:
            keep.add(ensure_slot(obj, mats[key]))
    for poly in obj.data.polygons:
        if poly.material_index in keep:
            continue
        c = poly.center
        n = poly.normal
        if n.z < -0.48 and c.z < body_c.z - 0.10 * CM and c.y > -0.4 * CM:
            poly.material_index = belly_i
        else:
            poly.material_index = back_i



def paint_head(obj, mats, head_c, head_s):
    """Colour-block a breeding-male head. No brown on the skull: blue crown,
    black mask, blue ear patch, black nape, deep-blue throat."""
    crown_i = ensure_slot(obj, mats["crown"])
    throat_i = ensure_slot(obj, mats["throat"])
    nape_i = ensure_slot(obj, mats["nape"])
    mask_i = ensure_slot(obj, mats["mask"])
    ear_i = ensure_slot(obj, mats["ear"])
    for poly in obj.data.polygons:
        c = poly.center
        dx = (c.x - head_c.x) / max(head_s.x, 1e-9)
        dy = (c.y - head_c.y) / max(head_s.y, 1e-9)
        dz = (c.z - head_c.z) / max(head_s.z, 1e-9)
        # Longitude 0 at the beak (-Y), + toward the right; latitude 0 at the equator.
        lon = math.degrees(math.atan2(dx, -dy))
        lat = math.degrees(math.atan2(dz, math.hypot(dx, dy)))
        # Ear patch: a side oval just behind the eye.
        if 55 <= abs(lon) <= 125 and -15 <= lat <= 40:
            poly.material_index = ear_i
            continue
        # Nape band: back of the skull.
        if abs(lon) >= 115 and lat < 55:
            poly.material_index = nape_i
            continue
        # Throat: lower front.
        if abs(lon) <= 55 and lat < 8:
            poly.material_index = throat_i
            continue
        # Crown: top and forehead, stopping at the nape.
        if lat > 8 and abs(lon) < 125:
            poly.material_index = crown_i
            continue
        poly.material_index = mask_i



def add_oriented_ellipsoid(name, mid, direction, scale, segments=8, rings=6):
    """UV sphere at mid, local Z along direction, then scale (x, y, z)."""
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=1.0, segments=segments, ring_count=rings, location=(0.0, 0.0, 0.0)
    )
    obj = bpy.context.active_object
    obj.name = name
    direction = Vector(direction)
    if direction.length < 1e-9:
        direction = Vector((0.0, 0.0, 1.0))
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(direction.normalized())
    obj.scale = scale
    obj.location = mid
    apply_all(obj)
    shade_smooth(obj)
    return obj


def add_feather(name, base, tip, width, mats, groups):
    """A flat, rounded feather from base to tip, skinned along its length."""
    mid = base.lerp(tip, 0.52)
    half_len = (tip - base).length * 0.52
    feather = add_oriented_ellipsoid(
        name, mid, tip - base,
        (width, width * 0.16, half_len),
        segments=8, rings=6,
    )
    set_material(feather, mats["tail"])
    assign_chain_weights(feather, [base, mid, tip], list(groups), parent_bone="body")
    return feather


def add_wing(name, side, shoulder, tip, mats, groups):
    """A folded teardrop wing along the flank, skinned in two halves."""
    mid = shoulder.lerp(tip, 0.52) + Vector((side * 0.12, 0.0, 0.06)) * CM
    wing = add_oriented_ellipsoid(
        name, mid, tip - shoulder,
        (0.22 * CM, 0.55 * CM, (tip - shoulder).length * 0.52),
        segments=10, rings=7,
    )
    # Keep it a thin leaf, slightly rounded, sitting against the body.
    # After orientation, local X is width; squash a little more in the thin axis.
    set_material(wing, mats["wing"])
    assign_chain_weights(wing, [shoulder, mid, tip], list(groups), parent_bone=None)
    return wing, mid


def build_meshes(mats):
    """Return (parts, bones). Face toward Blender -Y. Feet on Z=0."""
    parts = []
    bones = []

    # Plump body and a round head, blended together. Beak tip near y=-4.4,
    # rump near y=+2.6 (body ~7 cm). Tail is cocked up, tip near z=8.2.
    body_c = Vector((0.0, 0.45, 2.35)) * CM
    body_s = Vector((1.85, 2.25, 1.55)) * CM
    head_c = Vector((0.0, -1.90, 3.32)) * CM
    head_s = Vector((1.42, 1.40, 1.32)) * CM
    neck_c = Vector((0.0, -0.80, 2.90)) * CM
    neck_s = Vector((1.28, 1.18, 1.22)) * CM

    body = add_uv_sphere("body", 1.0, 16, 12, body_c, scale=body_s, poles="Y")
    set_material(body, mats["back"])
    neck = add_uv_sphere("neck", 1.0, 12, 10, neck_c, scale=neck_s, poles="Y")
    set_material(neck, mats["back"])
    body = boolean_union(body, [neck])
    body.name = "body"
    set_material(body, mats["back"])
    smooth_mesh(body, iterations=6, factor=0.50)
    # Body and neck only — a tight split so the chest does not follow the head.
    for name in ("neck", "body"):
        if not body.vertex_groups.get(name):
            body.vertex_groups.new(name=name)
    vg_n, vg_b = body.vertex_groups["neck"], body.vertex_groups["body"]
    for i, v in enumerate(body.data.vertices):
        if v.co.y < -0.20 * CM:
            vg_n.add([i], 1.0, "REPLACE")
        else:
            vg_b.add([i], 1.0, "REPLACE")
    paint_wren_body(body, mats, body_c)
    parts.append(body)

    # Head is its own sphere, overlapping the neck, so markings stay on clean rings.
    head = add_uv_sphere("head", 1.0, 24, 18, head_c, scale=head_s, poles="Z")
    set_material(head, mats["back"])
    paint_head(head, mats, head_c, head_s)
    assign_group(head, "head")
    parts.append(head)

    # Small pointed beak, slightly down-tilted, lower mandible tucked underneath.
    beak_base = Vector((0.0, -3.10, 3.12)) * CM
    beak_tip = Vector((0.0, -4.25, 2.90)) * CM
    beak = add_oriented_ellipsoid(
        "beak", beak_base.lerp(beak_tip, 0.55), beak_tip - beak_base,
        (0.16 * CM, 0.13 * CM, 0.55 * CM),
        segments=8, rings=6,
    )
    set_material(beak, mats["beak"])
    assign_group(beak, "beak")
    parts.append(beak)
    jaw_base = beak_base + Vector((0.0, 0.02, -0.10)) * CM
    jaw_tip = beak_tip + Vector((0.0, 0.08, -0.12)) * CM
    jaw = add_oriented_ellipsoid(
        "jaw", jaw_base.lerp(jaw_tip, 0.55), jaw_tip - jaw_base,
        (0.13 * CM, 0.09 * CM, 0.42 * CM),
        segments=7, rings=5,
    )
    set_material(jaw, mats["beak"])
    assign_group(jaw, "jaw")
    parts.append(jaw)

    # Big friendly eyes on the sides, slightly forward, with a round highlight.
    # Mask and ear colours are painted on the head sphere so they sit flush.
    eye_bones = {}
    eye_r = 0.40 * CM
    for side, name in ((1, "eye_L"), (-1, "eye_R")):
        s = float(side)
        guess = on_ellipsoid(head_c, head_s, (s * 0.82, -0.22, 0.10), 1.04)
        surface, look = snap_to_mesh(head, guess, inset=0.0)
        loc = surface - look * (eye_r * 0.12)
        eyeball = add_uv_sphere(name, eye_r, 12, 8, loc)
        set_material(eyeball, mats["eye"])
        assign_group(eyeball, "head")
        parts.append(eyeball)
        hl_dir = (look + Vector((0.0, 0.0, 0.55))).normalized()
        hl = add_uv_sphere(name + "_hl", 0.12 * CM, 6, 4, loc + hl_dir * (eye_r * 0.86))
        set_material(hl, mats["highlight"])
        assign_group(hl, "head")
        parts.append(hl)
        eye_bones[name] = (loc, loc + look * (0.18 * CM))

    # Folded wings along the flanks.
    wing_mid = {}
    for side, tag in ((1, "L"), (-1, "R")):
        s = float(side)
        shoulder = Vector((s * 1.50, -0.10, 2.60)) * CM
        tip = Vector((s * 1.70, 2.05, 1.95)) * CM
        names = [f"wing_{tag}", f"wing_{tag}2"]
        wing, mid = add_wing(f"wing_{tag}", s, shoulder, tip, mats, names)
        parts.append(wing)
        wing_mid[tag] = (shoulder, mid, tip)
        bones.append((names[0], "body", shoulder, mid))
        bones.append((names[1], names[0], mid, tip))

    # Long cocked tail: a small fan of flat feathers, almost upright.
    tail_base = Vector((0.0, 2.30, 2.60)) * CM
    tail_mid = Vector((0.0, 2.85, 5.20)) * CM
    tail_len = 5.8 * CM
    fan = (-16.0, -8.0, 0.0, 8.0, 16.0)
    for i, ang in enumerate(fan):
        direction = Vector((math.sin(r(ang)) * 0.28, 0.16, 1.0)).normalized()
        tip = tail_base + direction * tail_len
        width = (0.48 if ang == 0.0 else 0.40) * CM
        parts.append(add_feather(f"tail_{i}", tail_base, tip, width, mats, ["tail1", "tail2"]))
    tail_tip = tail_base + Vector((0.0, 0.16, 1.0)).normalized() * tail_len

        # Thin twiggy legs, three forward toes and a short back toe, feet on the ground.
    for side, tag in ((1, "L"), (-1, "R")):
        s = float(side)
        hip = Vector((s * 0.85, 0.35, 1.55)) * CM
        ankle = Vector((s * 0.90, 0.15, 0.32)) * CM
        toe = Vector((s * 0.90, -0.15, 0.06)) * CM
        names = [f"leg_{tag}", f"foot_{tag}"]
        leg = add_tapered_tube(
            f"leg_{tag}", [hip, ankle, toe],
            [0.16 * CM, 0.12 * CM, 0.10 * CM],
            verts=6, extra_rings=0, cap=True,
        )
        set_material(leg, mats["leg"])
        assign_chain_weights(leg, [hip, ankle, toe], names, parent_bone="body")
        parts.append(leg)
        # Toes: three forward, one short hallux back, pads on z=0.
        origin = Vector((s * 0.90, -0.05, 0.08)) * CM
        spreads = (-0.22, 0.0, 0.22, -0.02)
        reaches = (0.42, 0.52, 0.42, -0.28)  # last is the hallux, backward
        y_dirs = (-1.0, -1.0, -1.0, 1.0)
        for i, (sp, reach, yd) in enumerate(zip(spreads, reaches, y_dirs)):
            tip_t = Vector((
                origin.x + s * sp * CM,
                origin.y + yd * reach * CM,
                0.05 * CM,
            ))
            digit = add_tapered_tube(
                f"{tag}_toe{i}", [origin, tip_t],
                [0.08 * CM, 0.05 * CM],
                verts=5, extra_rings=0, cap=True,
            )
            set_material(digit, mats["leg"])
            assign_group(digit, names[1])
            parts.append(digit)
        bones.append((names[0], "body", hip, ankle))
        bones.append((names[1], names[0], ankle, toe))

    # Core bones. Body points toward the tail (+Y); head toward the beak (-Y).
    core = [
        ("root", None, Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.5)) * CM),
        ("body", "root", Vector((0.0, 0.2, 2.30)) * CM, Vector((0.0, 1.6, 2.35)) * CM),
        ("neck", "body", Vector((0.0, -0.7, 2.95)) * CM, Vector((0.0, -0.7, 2.95)) * CM + Vector((0.0, -0.8, 0.35)) * CM),
        ("head", "neck", Vector((0.0, -1.6, 3.35)) * CM, Vector((0.0, -3.1, 3.30)) * CM),
        ("beak", "head", beak_base, beak_tip),
        ("jaw", "head", jaw_base, jaw_tip),
        ("tail1", "body", tail_base, tail_mid),
        ("tail2", "tail1", tail_mid, tail_tip),
    ]
    # legs and wings already appended to bones
    return parts, core + bones


def zero_pose(arm):
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
    head = arm.pose.bones["head"]
    neck = arm.pose.bones["neck"]
    tail1 = arm.pose.bones["tail1"]
    tail2 = arm.pose.bones["tail2"]
    # Head tilts, a couple of tail flicks.
    for fr, hy, hz, ty, tz in (
        (0,   0,  0,  0, 0),
        (12,  8,  4,  6, 4),
        (24, -4, -3, -8, 0),
        (36, -9,  5,  4, -5),
        (48,  5, -2, -6, 3),
        (60,  0,  0,  0, 0),
    ):
        key_euler(head, fr, (r(hz * 0.4), r(hy), r(hz * 0.2)))
        key_euler(neck, fr, (r(hz * 0.2), r(hy * 0.4), 0))
        key_euler(tail1, fr, (r(tz * 0.5), r(ty), 0))
        key_euler(tail2, fr, (r(tz * 0.8), r(ty * 0.6), 0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "idle")
    return action


def animate_hop(arm):
    """A bounce pose only — no baked root translation. Code drives the hop along +Z."""
    action = ensure_action(arm, "hop", HOP_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, HOP_FRAMES)
    body = arm.pose.bones["body"]
    leg_l = arm.pose.bones["leg_L"]
    leg_r = arm.pose.bones["leg_R"]
    foot_l = arm.pose.bones["foot_L"]
    foot_r = arm.pose.bones["foot_R"]
    w_l = arm.pose.bones["wing_L"]
    w_r = arm.pose.bones["wing_R"]
    # Crouch, stretch, land. Keep eulers modest so the pose stays readable.
    for fr, crouch, stretch, flap in (
        (0, 0.0, 0.0, 0.0),
        (2, 1.0, 0.0, 0.3),
        (4, 0.0, 1.0, 0.8),
        (6, 0.2, 0.3, 0.3),
        (8, 0.0, 0.0, 0.0),
    ):
        key_euler(body, fr, (r(-6 * stretch + 8 * crouch), 0, 0))
        key_loc(body, fr, (0.0, 0.0, -0.15 * CM * crouch + 0.08 * CM * stretch))
        key_euler(leg_l, fr, (r(18 * crouch - 12 * stretch), 0, 0))
        key_euler(leg_r, fr, (r(18 * crouch - 12 * stretch), 0, 0))
        key_euler(foot_l, fr, (r(-10 * crouch), 0, 0))
        key_euler(foot_r, fr, (r(-10 * crouch), 0, 0))
        key_euler(w_l, fr, (0, 0, r(-22 * flap)))
        key_euler(w_r, fr, (0, 0, r(22 * flap)))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "hop")
    return action


def animate_fly(arm):
    action = ensure_action(arm, "fly", FLY_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    # Frame 0 and FLY_FRAMES are the wings-up pose, not rest. Keying rest
    # on those frames left a second key that hid the spread in previews.
    body = arm.pose.bones["body"]
    w_l = arm.pose.bones["wing_L"]
    w_l2 = arm.pose.bones["wing_L2"]
    w_r = arm.pose.bones["wing_R"]
    w_r2 = arm.pose.bones["wing_R2"]
    leg_l = arm.pose.bones["leg_L"]
    leg_r = arm.pose.bones["leg_R"]
    tail1 = arm.pose.bones["tail1"]
    # Wings spread out to the sides and flap once. Legs tuck. Tail slightly flatter.
    # Folded wings hang back along +Y; +Z rotation lifts them out to the sides.
    for fr, up, in_stroke in (
        (0,  1.0, 0.0),
        (3,  0.15, 1.0),
        (5, -0.2, 0.6),
        (8,  0.85, 0.0),
        (10, 1.0, 0.0),
    ):
        key_euler(body, fr, (r(-10), 0, 0))
        # Euler XYZ applies X before Z, so flapping on X first points the
        # folded wing up and the later Z spread does nothing useful. Spread
        # only on the root wing bone; flap on the child once it points out.
        key_euler(w_l, fr, (0, 0, r(-90)))
        key_euler(w_r, fr, (0, 0, r(90)))
        flap = 35 * up - 40 * in_stroke
        key_euler(w_l2, fr, (r(-flap), 0, 0))
        key_euler(w_r2, fr, (r(-flap), 0, 0))
        key_euler(leg_l, fr, (r(40), 0, r(-10)))
        key_euler(leg_r, fr, (r(40), 0, r(10)))
        key_euler(tail1, fr, (r(14), 0, 0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "fly")
    return action


def animate_peck(arm):
    action = ensure_action(arm, "peck", PECK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, PECK_FRAMES)
    head = arm.pose.bones["head"]
    neck = arm.pose.bones["neck"]
    body = arm.pose.bones["body"]
    beak = arm.pose.bones["beak"]
    jaw = arm.pose.bones["jaw"]
    for fr, dip, open_ in (
        (0,  0.0, 0.0),
        (3,  0.40, 0.15),
        (6,  1.00, 0.45),
        (8,  0.80, 0.0),
        (12, 0.0, 0.0),
    ):
        key_euler(body, fr, (r(6 * dip), 0, 0))
        key_euler(neck, fr, (r(12 * dip), 0, 0))
        key_euler(head, fr, (r(16 * dip), 0, 0))
        key_euler(jaw, fr, (r(14 * open_), 0, 0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "peck")
    return action


def animate_song(arm):
    action = ensure_action(arm, "song", SONG_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    key_rest(arm, 0)
    key_rest(arm, SONG_FRAMES)
    head = arm.pose.bones["head"]
    neck = arm.pose.bones["neck"]
    body = arm.pose.bones["body"]
    beak = arm.pose.bones["beak"]
    jaw = arm.pose.bones["jaw"]
    tail1 = arm.pose.bones["tail1"]
    tail2 = arm.pose.bones["tail2"]
    for fr, puff, open_, lift, ty in (
        (0,  0.0, 0.0, 0,  0),
        (4,  0.5, 0.5, 6,  8),
        (8,  1.0, 1.0, 10, 4),
        (12, 0.7, 0.7, 8, -6),
        (16, 1.0, 1.0, 12, 8),
        (20, 0.4, 0.3, 5,  2),
        (24, 0.0, 0.0, 0,  0),
    ):
        key_euler(body, fr, (r(-4 * lift * 0.1), 0, 0))
        key_euler(neck, fr, (r(-6 * lift * 0.1), 0, 0))
        key_euler(head, fr, (r(-lift), 0, 0))
        key_scale(neck, fr, (1.0 + 0.18 * puff, 1.0, 1.0 + 0.22 * puff))
        key_euler(beak, fr, (r(-8 * open_), 0, 0))
        key_euler(jaw, fr, (r(22 * open_), 0, 0))
        key_euler(tail1, fr, (r(-8 * lift * 0.15), r(ty * 0.4), 0))
        key_euler(tail2, fr, (0, r(ty * 0.5), 0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "song")
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

    world = bpy.data.worlds.new("WrenPreviewWorld") if "WrenPreviewWorld" not in bpy.data.worlds else bpy.data.worlds["WrenPreviewWorld"]
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

    add_light("Key", "SUN", (10, -14, 16), 2.0, (1.0, 0.97, 0.92))
    add_light("Fill", "AREA", (-10, -6, 10), 40.0, (0.85, 0.9, 1.0))

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
        action = bpy.data.actions.get(action_name)
        if arm.animation_data:
            arm.animation_data.use_nla = False
            arm.animation_data.action = action
            if action is not None and hasattr(arm.animation_data, "action_slot") and getattr(action, "slots", None):
                try:
                    if action.slots:
                        arm.animation_data.action_slot = action.slots[0]
                except Exception as exc:
                    print("slot assign:", exc)
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        _composite_cream(path, path)
        print("preview:", path)

    # Pulled back to fit the cocked tail and a flying pose.
    view_34 = ((12.5, -15.5, 10.0), (0.0, -0.2, 3.2))
    view_side = ((18.0, 0.2, 6.2), (0.0, 0.3, 3.0))
    PREVIEW_REPO.parent.mkdir(parents=True, exist_ok=True)
    _shot(PREVIEW_REPO, *view_34, "idle", 12)
    shutil.copy2(PREVIEW_REPO, PREVIEW_WORKSPACE)
    _shot(PREVIEW_SIDE, *view_side, "idle", 12)
    shutil.copy2(PREVIEW_SIDE, PREVIEW_REPO_SIDE)
    _shot(PREVIEW_FLY, *view_34, "fly", 0)
    shutil.copy2(PREVIEW_FLY, PREVIEW_REPO_FLY)
    _shot(PREVIEW_SONG, *view_34, "song", 8)
    shutil.copy2(PREVIEW_SONG, PREVIEW_REPO_SONG)
    # QA
    _shot(Path("/tmp/wren-top.png"), (0.2, -0.4, 24.0), (0.0, 0.6, 0.0), "idle", 12)
    _shot(Path("/tmp/wren-fly-side.png"), *view_side, "fly", 0)
    _shot(Path("/tmp/wren-hop.png"), *view_34, "hop", 4)
    _shot(Path("/tmp/wren-peck.png"), *view_34, "peck", 6)
    _shot(Path("/tmp/wren-song-side.png"), *view_side, "song", 8)

    if arm.animation_data:
        arm.animation_data.action = None
        arm.animation_data.use_nla = True
    for name in ("PreviewCam", "Key", "Fill"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)


def export_glb():
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    arm = bpy.data.objects.get("WrenArmature")
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
    mn = [float("inf")] * 3
    mx = [float("-inf")] * 3
    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
            if "min" in pos_acc and "max" in pos_acc:
                for i in range(3):
                    mn[i] = min(mn[i], pos_acc["min"][i])
                    mx[i] = max(mx[i], pos_acc["max"][i])
    box = None
    if mn[0] != float("inf"):
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
    if path.stat().st_size > 280 * 1024:
        raise SystemExit(f"glb is over 280 KB: {path.stat().st_size}")
    want = {"idle", "hop", "fly", "peck", "song"}
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
        print(f"length along Z={length_z:.5f} u, height Y={box['size'][1]:.5f} u, longest={length_max:.5f} u, expected={expected_length:.5f} u")
        if box["min"][1] < -0.008:
            print("WARNING: mesh extends well below the ground (Y min =", box["min"][1], ")")
    return report


def main():
    clear_scene()
    mats = {
        "crown": set_coat(make_mat("crown", CROWN, roughness=0.42, metallic=0.0), 0.22, 0.28),
        "ear": set_coat(make_mat("ear", EAR, roughness=0.42, metallic=0.0), 0.22, 0.28),
        "mask": make_mat("mask", MASK, roughness=0.70, metallic=0.0),
        "nape": make_mat("nape", NAPE, roughness=0.70, metallic=0.0),
        "throat": set_coat(make_mat("throat", THROAT, roughness=0.45, metallic=0.0), 0.16, 0.30),
        "back": set_coat(make_mat("back", BACK, roughness=0.55, metallic=0.0), 0.10, 0.35),
        "wing": set_coat(make_mat("wing", WING, roughness=0.55, metallic=0.0), 0.10, 0.35),
        "belly": make_mat("belly", BELLY, roughness=0.65, metallic=0.0),
        "tail": set_coat(make_mat("tail", TAIL, roughness=0.48, metallic=0.0), 0.14, 0.32),
        "beak": make_mat("beak", BEAK, roughness=0.45, metallic=0.0),
        "eye": set_coat(make_mat("eye", EYE, roughness=0.12, metallic=0.0), 0.35, 0.12),
        "highlight": make_mat("highlight", HIGHLIGHT, roughness=0.22, metallic=0.0, emission=0.35),
        "leg": make_mat("leg", LEG, roughness=0.55, metallic=0.0),
    }
    parts, bones = build_meshes(mats)
    for obj in parts:
        print(f"  {obj.name}: {triangle_count(obj)}")
    mesh = join_objects("Wren", parts)
    fb = mesh.vertex_groups.get("body") or mesh.vertex_groups.new(name="body")
    missing = [i for i, v in enumerate(mesh.data.vertices) if not v.groups]
    if missing:
        fb.add(missing, 1.0, "REPLACE")
        print(f"filled {len(missing)} unweighted verts")
    tris = triangle_count(mesh)
    print(f"joined mesh triangles: {tris}")
    if tris > 3000:
        raise SystemExit(f"too many triangles: {tris}")
    arm = build_armature(bones)
    arm.name = "WrenArmature"
    bind(mesh, arm)
    animate_idle(arm)
    animate_hop(arm)
    animate_fly(arm)
    animate_peck(arm)
    animate_song(arm)
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
