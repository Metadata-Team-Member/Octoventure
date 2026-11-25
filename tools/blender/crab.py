"""Build the Octoventure soft-toon shore crab and export public/models/crab.glb.

Run from the repo (or anywhere) with:
    /opt/blender/blender -b --python tools/blender/crab.py

Style
-----
A cute Australian rock / shore crab: warm coral-orange carapace, cream
underside, soft darker speckles, one claw slightly larger than the
other. High lightness contrast (no blue, which would vanish against
the water and is harder for colour-blind players).

Scale
-----
The game's octopus is 20 cm = 0.63 world units (1 cm = 0.0315 u).
This crab's carapace is 5.5 cm wide (0.173 u). Use scale 1.0 at hookup.
The current gather crab is a larger ~8–10 cm procedural shell; see the
report in the hookup brief.

Orientation
-----------
Modelled in Blender with +Z up and the face/claws toward -Y, which the
glTF exporter (export_yup=True) maps to +Y up, +Z forward. Origin is on
the ground, between the feet.

Walk direction
--------------
Crabs scuttle sideways. The 'walk' clip is an in-place sideways gait
along local +X (the crab's right). The hookup should keep the body
facing +Z (claws forward) and move the object perpendicular to that
heading (the existing gather crab already adds +PI/2 to its yaw).

Animations
----------
- walk (0.5 s): sideways scuttle along +X, looping
- idle (2 s): eye-stalk bob and a claw wave, looping
- snap (0.4 s): a quick pinch of the larger claw, not a loop
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

# ---------------------------------------------------------------------------
# Paths and scale
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[2]
GLB_PATH = ROOT / "public" / "models" / "crab.glb"
PREVIEW_REPO = ROOT / "tools" / "blender" / "crab-preview.png"
PREVIEW_REPO_SIDE = ROOT / "tools" / "blender" / "crab-preview-side.png"
PREVIEW_WORKSPACE = Path("/workspace/crab-preview.png")
PREVIEW_SIDE = Path("/workspace/crab-preview-side.png")

CM = 0.0315
CARAPACE_WIDTH_CM = 5.5
EXPORT_WIDTH = CARAPACE_WIDTH_CM * CM  # 0.17325 world units

# Warm coral-orange shell, cream belly, darker speckles.
SHELL = (0xFF / 255, 0x5C / 255, 0x28 / 255, 1.0)       # #FF5C28
SPECKLE = (0xD0 / 255, 0x38 / 255, 0x18 / 255, 1.0)     # #D03818
CREAM = (0xF8 / 255, 0xE8 / 255, 0xCC / 255, 1.0)       # #F8E8CC
CREAM_TIP = (0xF6 / 255, 0xD7 / 255, 0xA0 / 255, 1.0)  # #F6D7A0 warm cream, not grey
LEG = (0xF4 / 255, 0x58 / 255, 0x28 / 255, 1.0)         # #F45828
EYE = (0x1A / 255, 0x1A / 255, 0x1A / 255, 1.0)         # #1A1A1A
HIGHLIGHT = (1.0, 1.0, 1.0, 1.0)

FPS = 24
WALK_FRAMES = 12          # 0.5 s
IDLE_FRAMES = 48          # 2.0 s
SNAP_FRAMES = 10          # ~0.4 s


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                  bpy.data.actions, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            block.remove(item)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = max(WALK_FRAMES, IDLE_FRAMES, SNAP_FRAMES)
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
    # Origin stays at the world origin because every part already had
    # its transform applied (vertices are in world space).
    obj.location = (0.0, 0.0, 0.0)
    shade_smooth(obj)
    bpy.ops.object.shade_smooth()
    return obj


def triangle_count(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


# ---------------------------------------------------------------------------
# Mesh
# ---------------------------------------------------------------------------

def on_ellipsoid(center, half, direction, embed=1.0):
    d = Vector(direction)
    if d.length < 1e-9:
        d = Vector((0.0, 0.0, 1.0))
    d.normalize()
    return Vector(center) + Vector((half.x * d.x, half.y * d.y, half.z * d.z)) * embed


def build_meshes(mats):
    """Return (parts, bones). Face and claws point Blender -Y.

    A cute, wide shore crab: short arms hold puffy almost-closed claws
    up in front of the face, and eight bent legs splay symmetrically
    from the sides of the carapace.
    """
    # 5.5 cm wide, a touch wider than long, raised so bent legs can sit under it.
    body_c = Vector((0.0, 0.0, 1.55)) * CM
    body_s = Vector((2.75, 1.85, 1.10)) * CM
    parts = []

    carapace = add_uv_sphere("carapace", 1.0, 16, 8, body_c, scale=body_s)
    set_material(carapace, mats["shell"])
    assign_group(carapace, "body")
    parts.append(carapace)

    # Cream underside, wide enough to show as a rim under the shell.
    belly_c = Vector((0.0, 0.04, 0.98)) * CM
    belly_s = Vector((2.52, 1.68, 0.58)) * CM
    belly = add_uv_sphere("belly", 1.0, 10, 6, belly_c, scale=belly_s)
    set_material(belly, mats["cream"])
    assign_group(belly, "body")
    parts.append(belly)

    speckles = [
        ((0.52,  0.05, 0.88), 0.38),
        ((0.62, -0.48, 0.55), 0.26),
        ((-0.52,  0.05, 0.88), 0.38),
        ((-0.62, -0.48, 0.55), 0.26),
    ]
    for i, (direction, rad_cm) in enumerate(speckles):
        surface = on_ellipsoid(body_c, body_s, direction, 1.0)
        normal = ellipsoid_normal(body_c, body_s, surface)
        disc = add_surface_disc(
            f"speckle_{i}", surface, normal, rad_cm * CM,
            thickness=0.26, segments=10, rings=2, inset=0.12,
        )
        set_material(disc, mats["speckle"])
        assign_group(disc, "body")
        parts.append(disc)

    mouth = add_uv_sphere(
        "mouth", 0.20 * CM, 6, 4,
        Vector((0.0, -1.80, 1.25)) * CM,
        scale=Vector((0.40, 0.28, 0.18)) * CM,
    )
    set_material(mouth, mats["cream"])
    assign_group(mouth, "body")
    parts.append(mouth)

    # Big cute eyes on short upright stalks, wide apart at the front.
    eye_bones = {}
    for side, name in ((1, "eye_L"), (-1, "eye_R")):
        base = Vector((side * 1.20, -1.48, 2.40)) * CM
        tip = Vector((side * 1.28, -1.52, 2.90)) * CM
        stalk = add_cylinder_between(name + "_stalk", base, tip, 0.16 * CM, verts=6)
        set_material(stalk, mats["shell"])
        assign_group(stalk, name)
        parts.append(stalk)
        eye_r = 0.48 * CM
        eye = add_uv_sphere(name, eye_r, 8, 6, tip)
        set_material(eye, mats["eye"])
        assign_group(eye, name)
        parts.append(eye)
        # Catchlight on the front of the eye, slightly toward the midline.
        direction = Vector((-side * 0.15, -0.85, 0.35)).normalized()
        surface = tip + direction * eye_r
        hl = add_uv_sphere(name + "_hl", 0.14 * CM, 6, 4, surface - direction * (0.02 * CM))
        set_material(hl, mats["highlight"])
        assign_group(hl, name)
        parts.append(hl)
        eye_bones[name] = (base, tip)

    # Short folded arms, puffy almost-closed claws held up in front of the face.
    # The crab's right (Blender -X, facing -Y) is slightly larger.
    claw_bones = {}
    claw_plan = [
        ("claw_L",  1, 1.00, "claw_L", "claw_L_pin"),
        ("claw_R", -1, 1.16, "claw_R", "claw_R_pin"),
    ]
    for name, side, sc, bone, pin_bone in claw_plan:
        shoulder = Vector((side * 2.15, -1.50, 1.55)) * CM
        palm = Vector((side * 1.80, -2.50, 2.30)) * CM
        coxa = add_uv_sphere(name + "_coxa", 0.38 * sc * CM, 6, 4, shoulder)
        set_material(coxa, mats["shell"])
        assign_group(coxa, "body")
        parts.append(coxa)
        arm = add_cylinder_between(name + "_arm", shoulder, palm, 0.30 * sc * CM, verts=6)
        set_material(arm, mats["shell"])
        assign_group(arm, bone)
        parts.append(arm)
        palm_r = 0.68 * sc * CM
        palm_obj = add_uv_sphere(
            name + "_palm", palm_r, 8, 6, palm,
            scale=Vector((1.15, 1.05, 0.90)),
        )
        set_material(palm_obj, mats["shell"])
        assign_group(palm_obj, bone)
        parts.append(palm_obj)

        # Fixed upper and movable lower finger. Opening faces inward
        # so both tips read from the front; mostly closed at rest.
        fingers = [
            # tag, x_base, y_base, z_base, x_tip, y_tip, z_tip, rad, group
            ("up", -0.06, -0.40,  0.24, -0.22, -1.05,  0.10, 0.26, bone),
            ("lo",  0.16, -0.38, -0.14, -0.08, -1.00,  0.02, 0.22, pin_bone),
        ]
        lo_tip = None
        for tag, xb, yb, zb, xt, yt, zt, rad, group in fingers:
            a = palm + Vector((side * xb * sc, yb * sc, zb * sc)) * CM
            b = palm + Vector((side * xt * sc, yt * sc, zt * sc)) * CM
            finger = add_cylinder_between(f"{name}_{tag}", a, b, rad * sc * CM, verts=6)
            set_material(finger, mats["shell"])
            assign_group(finger, group)
            parts.append(finger)
            kn = add_uv_sphere(f"{name}_{tag}_kn", (rad + 0.04) * sc * CM, 6, 4, a)
            set_material(kn, mats["shell"])
            assign_group(kn, group)
            parts.append(kn)
            tip = add_uv_sphere(f"{name}_{tag}_tip", 0.22 * sc * CM, 6, 4, b)
            set_material(tip, mats["cream_tip"])
            assign_group(tip, group)
            parts.append(tip)
            if tag == "lo":
                lo_tip = b
        claw_bones[bone] = (shoulder, palm)
        claw_bones[pin_bone] = (palm, lo_tip)

    # Eight bent walking legs, four per side, splayed outward from the hips.
    foot_r = 0.24 * CM
    thigh_r = 0.19 * CM
    shin_r = 0.16 * CM
    coxa_r = 0.24 * CM
    knee_r = 0.20 * CM
    # name, side, hip_y, knee_x, knee_y, knee_z, foot_x, foot_y  (cm)
    leg_plan = [
        ("leg_L1",  1, -1.25, 3.20, -1.85, 2.05, 3.90, -2.25),
        ("leg_L2",  1, -0.42, 3.50, -0.55, 2.18, 4.30, -0.70),
        ("leg_L3",  1,  0.42, 3.50,  0.55, 2.18, 4.30,  0.70),
        ("leg_L4",  1,  1.25, 3.20,  1.85, 2.05, 3.90,  2.25),
        ("leg_R1", -1, -1.25, 3.20, -1.85, 2.05, 3.90, -2.25),
        ("leg_R2", -1, -0.42, 3.50, -0.55, 2.18, 4.30, -0.70),
        ("leg_R3", -1,  0.42, 3.50,  0.55, 2.18, 4.30,  0.70),
        ("leg_R4", -1,  1.25, 3.20,  1.85, 2.05, 3.90,  2.25),
    ]
    bones_legs = []
    for name, side, hip_y, knee_x, knee_y, knee_z, foot_x, foot_y in leg_plan:
        hip = Vector((side * 2.20, hip_y, 1.10)) * CM
        knee = Vector((side * knee_x, knee_y, knee_z)) * CM
        foot_c = Vector((side * foot_x, foot_y, 0.24)) * CM
        coxa = add_uv_sphere(name + "_coxa", coxa_r, 6, 4, hip)
        set_material(coxa, mats["leg"])
        assign_group(coxa, "body")
        parts.append(coxa)
        toward_k = (knee - hip).normalized()
        thigh = add_cylinder_between(name + "_th", hip, knee - toward_k * (knee_r * 0.35), thigh_r, verts=6)
        set_material(thigh, mats["leg"])
        assign_group(thigh, name)
        parts.append(thigh)
        kn = add_uv_sphere(name + "_knee", knee_r, 6, 4, knee)
        set_material(kn, mats["leg"])
        assign_group(kn, name)
        parts.append(kn)
        shin_name = name + "_shin"
        toward_f = (foot_c - knee).normalized()
        shin = add_cylinder_between(
            name + "_sh",
            knee + toward_f * (knee_r * 0.35),
            foot_c - toward_f * (foot_r * 0.45),
            shin_r, verts=6,
        )
        set_material(shin, mats["leg"])
        assign_group(shin, shin_name)
        parts.append(shin)
        foot_obj = add_uv_sphere(name + "_foot", foot_r, 6, 4, foot_c)
        set_material(foot_obj, mats["leg"])
        assign_group(foot_obj, shin_name)
        parts.append(foot_obj)
        bones_legs.append((name, "body", hip, knee))
        bones_legs.append((shin_name, name, knee, foot_c))

    root_tail = Vector((0.0, 0.0, 0.25)) * CM
    bones = [
        ("root", None, Vector((0.0, 0.0, 0.0)), root_tail),
        ("body", "root", body_c + Vector((0, 0, -0.4 * CM)), body_c + Vector((0, 0, 0.6 * CM))),
        ("eye_L", "body", eye_bones["eye_L"][0], eye_bones["eye_L"][1]),
        ("eye_R", "body", eye_bones["eye_R"][0], eye_bones["eye_R"][1]),
        ("claw_L", "body", claw_bones["claw_L"][0], claw_bones["claw_L"][1]),
        ("claw_L_pin", "claw_L", claw_bones["claw_L_pin"][0], claw_bones["claw_L_pin"][1]),
        ("claw_R", "body", claw_bones["claw_R"][0], claw_bones["claw_R"][1]),
        ("claw_R_pin", "claw_R", claw_bones["claw_R_pin"][0], claw_bones["claw_R_pin"][1]),
    ]
    bones.extend(bones_legs)
    return parts, bones


def build_armature(bones):
    data = bpy.data.armatures.new("CrabArmature")
    data.display_type = "OCTAHEDRAL"
    arm = bpy.data.objects.new("CrabArmature", data)
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



def animate_walk(arm):
    """In-place sideways scuttle along local +X, 0.5 s loop.

    Alternating groups of four bent legs, with the shin folding a
    little on the swing so the feet stay clear of the ground.
    """
    action = ensure_action(arm, "walk", WALK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")

    group_a = ("leg_L1", "leg_L3", "leg_R2", "leg_R4")
    group_b = ("leg_L2", "leg_L4", "leg_R1", "leg_R3")

    def side_of(name):
        return 1 if "_L" in name else -1

    def thigh_pose(name, phase):
        s = side_of(name)
        if phase == "plant_lead":
            return (math.radians(-5), 0.0, s * math.radians(8))
        if phase == "plant_trail":
            return (math.radians(-5), 0.0, -s * math.radians(8))
        if phase == "swing_mid":
            return (math.radians(16), 0.0, s * math.radians(12))
        return (0.0, 0.0, 0.0)

    def shin_pose(phase):
        if phase == "swing_mid":
            return (math.radians(18), 0.0, 0.0)
        if phase in ("plant_lead", "plant_trail"):
            return (math.radians(-4), 0.0, 0.0)
        return (0.0, 0.0, 0.0)

    keys_a = {0: "plant_lead", 6: "plant_trail", 9: "swing_mid", 12: "plant_lead"}
    keys_b = {0: "plant_trail", 3: "swing_mid", 6: "plant_lead", 12: "plant_trail"}
    for name, keys in ((group_a, keys_a), (group_b, keys_b)):
        for bone in name:
            pb = arm.pose.bones[bone]
            shin = arm.pose.bones[bone + "_shin"]
            for fr, phase in keys.items():
                key_euler(pb, fr, thigh_pose(bone, phase))
                key_euler(shin, fr, shin_pose(phase))

    pb = arm.pose.bones["body"]
    key_euler(pb, 0, (0, 0, 0))
    key_euler(pb, 3, (math.radians(2), 0, math.radians(2)))
    key_euler(pb, 6, (0, 0, 0))
    key_euler(pb, 9, (math.radians(2), 0, math.radians(-2)))
    key_euler(pb, 12, (0, 0, 0))

    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "walk")
    return action


def animate_idle(arm):
    """Eye-stalk bob and a friendly wave of the larger claw, 2 s loop."""
    action = ensure_action(arm, "idle", IDLE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")

    def twitch(name, frames):
        pb = arm.pose.bones[name]
        for fr, euler in frames:
            key_euler(pb, fr, euler)

    twitch("eye_L", [
        (0, (0, 0, 0)),
        (12, (math.radians(8), 0, math.radians(6))),
        (28, (math.radians(-5), 0, math.radians(-4))),
        (48, (0, 0, 0)),
    ])
    twitch("eye_R", [
        (0, (0, 0, 0)),
        (16, (math.radians(-6), 0, math.radians(-5))),
        (32, (math.radians(7), 0, math.radians(4))),
        (48, (0, 0, 0)),
    ])
    # Short arm waves a little; the movable finger opens and closes slightly.
    twitch("claw_R", [
        (0, (0, 0, 0)),
        (14, (math.radians(-8), 0, math.radians(8))),
        (26, (math.radians(-4), 0, math.radians(12))),
        (38, (math.radians(-6), 0, math.radians(6))),
        (48, (0, 0, 0)),
    ])
    twitch("claw_R_pin", [
        (0, (0, 0, 0)),
        (14, (math.radians(12), 0, 0)),
        (26, (math.radians(-6), 0, 0)),
        (38, (math.radians(8), 0, 0)),
        (48, (0, 0, 0)),
    ])
    twitch("claw_L_pin", [
        (0, (0, 0, 0)),
        (24, (math.radians(6), 0, 0)),
        (48, (0, 0, 0)),
    ])

    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "idle")
    return action


def animate_snap(arm):
    """A quick pinch of the larger claw, 0.4 s, not a loop."""
    action = ensure_action(arm, "snap", SNAP_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm.pose.bones["claw_R"]
    pin = arm.pose.bones["claw_R_pin"]
    key_euler(pb, 0, (0, 0, 0))
    key_euler(pb, 3, (math.radians(-6), 0, math.radians(5)))
    key_euler(pb, 6, (math.radians(-3), 0, math.radians(2)))
    key_euler(pb, 10, (0, 0, 0))
    key_euler(pin, 0, (0, 0, 0))
    key_euler(pin, 2, (math.radians(20), 0, 0))   # open
    key_euler(pin, 5, (math.radians(-14), 0, 0))  # snap shut
    key_euler(pin, 10, (0, 0, 0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "snap")
    return action


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



# ---------------------------------------------------------------------------
# Preview render
# ---------------------------------------------------------------------------
def render_preview(arm, look_at=None):
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
    vs.exposure = 0.25
    vs.gamma = 1.0

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 600
    scene.render.resolution_y = 600
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

    world = bpy.data.worlds.new("CrabPreviewWorld") if "CrabPreviewWorld" not in bpy.data.worlds else bpy.data.worlds["CrabPreviewWorld"]
    world.use_nodes = False
    world.color = (0.95, 0.92, 0.86)
    scene.world = world
    if hasattr(shading, "background_type"):
        shading.background_type = "WORLD"
    if hasattr(shading, "background_color"):
        shading.background_color = (0.95, 0.92, 0.86)

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 45
    cam_data.clip_start = 0.001
    cam_data.clip_end = 10
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

    add_light("Key", "SUN", (4, -6, 8), 2.0, (1.0, 0.97, 0.92))
    add_light("Fill", "AREA", (-5, -3, 4), 40.0, (0.85, 0.9, 1.0))

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
            arm.animation_data.action = bpy.data.actions.get(action_name)
        scene.frame_set(frame)
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        _composite_cream(path, path)
        print("preview:", path)

    # 3/4 from the front-right, and a true side view (along +X).
    view_34 = ((3.6, -10.2, 7.8), (0.0, -0.25, 1.35))
    view_side = ((11.5, 0.15, 3.8), (0.0, -0.25, 1.3))
    PREVIEW_REPO.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_WORKSPACE.parent.mkdir(parents=True, exist_ok=True)
    _shot(PREVIEW_REPO, *view_34, "idle", 0)
    shutil.copy2(PREVIEW_REPO, PREVIEW_WORKSPACE)
    _shot(PREVIEW_SIDE, *view_side, "idle", 0)
    shutil.copy2(PREVIEW_SIDE, PREVIEW_REPO_SIDE)
    for fr in (0, 3, 6, 9):
        _shot(Path(f"/tmp/crab-walk-side-{fr}.png"), *view_side, "walk", fr)
        _shot(Path(f"/tmp/crab-walk-34-{fr}.png"), *view_34, "walk", fr)
    _shot(Path("/tmp/crab-snap.png"), *view_34, "snap", 5)
    _shot(Path("/tmp/crab-top.png"), (0.3, -0.8, 16.5), (0.0, -0.2, 0.0), "idle", 0)

    for name in ("PreviewCam", "Key", "Fill"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)


def export_glb():
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Clear any leftover action so export uses stored actions.
    arm = bpy.data.objects.get("CrabArmature")
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
        export_optimize_animation_size=False,
        export_force_sampling=True,
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
    # World-space AABB from the first mesh POSITION accessor, plus node transforms.
    # With a skinned mesh the rest-pose min/max on the accessor is in mesh local space.
    pos_acc = None
    for mesh in meshes:
        for prim in mesh.get("primitives", []):
            pos_acc = gltf["accessors"][prim["attributes"]["POSITION"]]
            break
    box = None
    if pos_acc and "min" in pos_acc and "max" in pos_acc:
        mn, mx = pos_acc["min"], pos_acc["max"]
        box = {
            "min": mn,
            "max": mx,
            "size": [mx[i] - mn[i] for i in range(3)],
        }
    report = {
        "bytes": path.stat().st_size,
        "triangles": tris,
        "animations": anims,
        "skins": len(skins),
        "joints": (skins[0].get("joints") if skins else None) and len(skins[0]["joints"]),
        "bbox": box,
        "expected_length": expected_length,
        "materials": [m["name"] for m in gltf.get("materials", [])],
        "nodes": [n.get("name") for n in gltf.get("nodes", [])],
    }
    print("GLB inspect:", json.dumps(report, indent=2))
    if tris == 0 or tris > 2800:
        raise SystemExit(f"triangle count {tris} out of range (1–2800)")
    missing = [n for n in ("walk", "idle", "snap") if n not in anims]
    if missing:
        # Some exporters prefix or suffix the action name; show what we got.
        lower = {a.lower() for a in anims}
        if not missing or ({"walk", "idle", "snap"} <= lower):
            print("animation names are present with different casing:", anims)
        else:
            raise SystemExit(f"missing animations {missing}; have {anims}")
    if box:
        # After Y-up conversion, length should be along Z.
        length_z = box["size"][2]
        length_max = max(box["size"])
        print(f"length along Z={length_z:.5f} u, longest axis={length_max:.5f} u, expected={expected_length:.5f} u")
        if abs(length_max - expected_length) / expected_length > 0.25:
            print("NOTE: longest axis is the stance/claw span, not the 5.5 cm carapace; hookup uses scale 1.0")
        if box["min"][1] < -0.005:
            print("WARNING: mesh extends well below the ground (Y min =", box["min"][1], ")")
    return report




def main():
    clear_scene()
    mats = {
        "shell": set_coat(make_mat("CrabShell", SHELL, roughness=0.38, metallic=0.0), 0.30, 0.18),
        "speckle": make_mat("CrabSpeckle", SPECKLE, roughness=0.55, metallic=0.0),
        "cream": make_mat("CrabCream", CREAM, roughness=0.72, metallic=0.0),
        "cream_tip": make_mat("CrabCreamTip", CREAM_TIP, roughness=0.62, metallic=0.0),
        "leg": make_mat("CrabLeg", LEG, roughness=0.60, metallic=0.0),
        "eye": make_mat("CrabEye", EYE, roughness=0.18, metallic=0.0),
        "highlight": make_mat("CrabHighlight", HIGHLIGHT, roughness=0.25, metallic=0.0, emission=0.35),
    }
    parts, bones = build_meshes(mats)
    mesh = join_objects("Crab", parts)
    tris = triangle_count(mesh)
    print(f"joined mesh triangles: {tris}")
    if tris > 2800:
        raise SystemExit(f"too many triangles: {tris}")
    arm = build_armature(bones)
    bind(mesh, arm)
    animate_walk(arm)
    animate_idle(arm)
    animate_snap(arm)
    render_preview(arm)
    export_glb()
    inspect_glb(GLB_PATH, EXPORT_WIDTH)
    print("done")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.exit(1)
