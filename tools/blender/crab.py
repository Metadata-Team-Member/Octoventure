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
SHELL = (0xFF / 255, 0x4E / 255, 0x1C / 255, 1.0)       # #FF4E1C
SPECKLE = (0xC2 / 255, 0x32 / 255, 0x14 / 255, 1.0)     # #C23214
CREAM = (0xF8 / 255, 0xE8 / 255, 0xCC / 255, 1.0)       # #F8E8CC
LEG = (0xF0 / 255, 0x46 / 255, 0x22 / 255, 1.0)         # #F04622
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
    """Return (parts, bones). Face and claws point Blender -Y."""
    # Carapace 5.5 cm wide, ~4.0 cm long, a low rounded dome.
    body_c = Vector((0.0, 0.05, 1.40)) * CM
    body_s = Vector((2.75, 2.00, 1.05)) * CM
    parts = []

    carapace = add_uv_sphere("carapace", 1.0, 16, 8, body_c, scale=body_s)
    set_material(carapace, mats["shell"])
    assign_group(carapace, "body")
    parts.append(carapace)

    # Cream underside, slightly smaller, tucked under the shell.
    belly_c = Vector((0.0, 0.08, 0.88)) * CM
    belly_s = Vector((2.20, 1.65, 0.55)) * CM
    belly = add_uv_sphere("belly", 1.0, 10, 6, belly_c, scale=belly_s)
    set_material(belly, mats["cream"])
    assign_group(belly, "body")
    parts.append(belly)

    # Soft darker speckles on the carapace, mirrored, as smooth discs.
    speckles = [
        ((0.50,  0.10, 0.90), 0.40),
        ((0.65, -0.40, 0.58), 0.28),
        ((-0.50,  0.10, 0.90), 0.40),
        ((-0.65, -0.40, 0.58), 0.28),
    ]
    for i, (direction, rad_cm) in enumerate(speckles):
        surface = on_ellipsoid(body_c, body_s, direction, 1.0)
        normal = ellipsoid_normal(body_c, body_s, surface)
        disc = add_surface_disc(
            f"speckle_{i}", surface, normal, rad_cm * CM,
            thickness=0.26, segments=12, rings=2, inset=0.12,
        )
        set_material(disc, mats["speckle"])
        assign_group(disc, "body")
        parts.append(disc)

    # A tiny mouth / rostrum at the front.
    mouth = add_uv_sphere("mouth", 0.22 * CM, 7, 5, Vector((0.0, -1.85, 1.15)) * CM, scale=Vector((0.35, 0.28, 0.18)) * CM)
    set_material(mouth, mats["cream"])
    assign_group(mouth, "body")
    parts.append(mouth)

    # Eye stalks and big friendly eyes with catchlights.
    eye_bones = {}
    for side, name in ((1, "eye_L"), (-1, "eye_R")):
        base = Vector((side * 0.72, -1.58, 2.00)) * CM
        tip = Vector((side * 0.86, -1.82, 2.42)) * CM
        stalk = add_cylinder_between(name + "_stalk", base, tip, 0.14 * CM, verts=8)
        set_material(stalk, mats["shell"])
        assign_group(stalk, name)
        parts.append(stalk)
        eye = add_uv_sphere(name, 0.32 * CM, 8, 6, tip)
        set_material(eye, mats["eye"])
        assign_group(eye, name)
        parts.append(eye)
        direction = Vector((side * 0.35, -0.7, 0.45)).normalized()
        surface = tip + direction * (0.32 * CM)
        hl = add_uv_sphere(name + "_hl", 0.10 * CM, 6, 4, surface - direction * (0.03 * CM))
        set_material(hl, mats["highlight"])
        assign_group(hl, name)
        parts.append(hl)
        eye_bones[name] = (base, tip)

    # Two claws: the crab's right (Blender -X, facing -Y) is slightly larger.
    claws = []
    # name, side_x, scale, bone names
    claw_plan = [
        ("claw_L",  1, 1.00, "claw_L", "claw_L_pin"),
        ("claw_R", -1, 1.22, "claw_R", "claw_R_pin"),
    ]
    claw_bones = {}
    for name, side, sc, bone, pin_bone in claw_plan:
        shoulder = Vector((side * 2.05, -1.55, 1.25)) * CM
        palm = Vector((side * 2.55, -2.85, 1.35)) * CM
        # Shoulder bead, weighted to the body so the arm stays seated.
        coxa = add_uv_sphere(name + "_coxa", 0.36 * sc * CM, 8, 5, shoulder)
        set_material(coxa, mats["shell"])
        assign_group(coxa, "body")
        parts.append(coxa)
        arm = add_cylinder_between(name + "_arm", shoulder, palm, 0.22 * sc * CM, verts=8)
        set_material(arm, mats["shell"])
        assign_group(arm, bone)
        parts.append(arm)
        palm_r = 0.52 * sc * CM
        palm_obj = add_uv_sphere(name + "_palm", palm_r, 10, 7, palm)
        set_material(palm_obj, mats["shell"])
        assign_group(palm_obj, bone)
        parts.append(palm_obj)
        # Two clearly separated pincers with a mid kink, so they read as a claw.
        for tag, z_sign, group in (("up", 1.0, bone), ("lo", -1.0, pin_bone)):
            a = palm + Vector((side * 0.02, -0.12, z_sign * 0.26 * sc)) * CM
            mid = palm + Vector((side * 0.08, -0.80 * sc, z_sign * 0.20 * sc)) * CM
            b = palm + Vector((side * 0.04, -1.45 * sc, z_sign * 0.06 * sc)) * CM
            for tag2, p0, p1 in (("a", a, mid), ("b", mid, b)):
                pin = add_cylinder_between(f"{name}_{tag}_{tag2}", p0, p1, 0.15 * sc * CM, verts=6)
                set_material(pin, mats["shell"])
                assign_group(pin, group)
                parts.append(pin)
            tip = add_uv_sphere(f"{name}_{tag}_tip", 0.14 * sc * CM, 7, 5, b)
            set_material(tip, mats["cream"])
            assign_group(tip, group)
            parts.append(tip)
        claw_bones[bone] = (shoulder, palm)
        claw_bones[pin_bone] = (palm, palm + Vector((0.0, -1.45 * sc, -0.06 * sc)) * CM)
        claws.append((bone, pin_bone, side, sc))

    # Eight walking legs, four each side, seated with coxa joints.
    foot_r = 0.22 * CM
    leg_r = 0.15 * CM
    coxa_r = 0.22 * CM
    # name, side, hip_y_cm, foot_x_cm, foot_y_cm
    leg_plan = [
        ("leg_L1",  1, -1.15,  3.35, -1.55),
        ("leg_L2",  1, -0.30,  3.70, -0.35),
        ("leg_L3",  1,  0.50,  3.60,  0.70),
        ("leg_L4",  1,  1.30,  3.15,  1.70),
        ("leg_R1", -1, -1.15,  3.35, -1.55),
        ("leg_R2", -1, -0.30,  3.70, -0.35),
        ("leg_R3", -1,  0.50,  3.60,  0.70),
        ("leg_R4", -1,  1.30,  3.15,  1.70),
    ]
    bones_legs = []
    for name, side, hip_y, foot_x, foot_y in leg_plan:
        # Aim at the underside edge of the carapace.
        aim = Vector((side * 2.40, hip_y, 0.85)) * CM
        direction = aim - body_c
        if direction.length < 1e-9:
            direction = Vector((side, 0.0, -0.4))
        direction.normalize()
        # Sit slightly inside the carapace so the coxa stays embedded.
        hip = body_c + direction * (min(body_s.x, body_s.z) * 0.95)
        # Nudge onto the lower side rather than the top of the dome.
        hip = Vector((hip.x, hip.y, min(hip.z, 1.05 * CM)))
        # Recompute from a lower aim so hips are under the rim, not on top.
        hip = Vector((side * 2.15, hip_y, 0.95)) * CM
        foot = Vector((side * foot_x, foot_y, 0.0)) * CM
        foot_c = Vector((foot.x, foot.y, foot_r))
        coxa = add_uv_sphere(name + "_coxa", coxa_r, 6, 4, hip)
        set_material(coxa, mats["leg"])
        assign_group(coxa, "body")
        parts.append(coxa)
        toward = (foot_c - hip).normalized()
        shin_end = foot_c - toward * (foot_r * 0.55)
        tube = add_cylinder_between(name, hip, shin_end, leg_r, verts=6)
        set_material(tube, mats["leg"])
        assign_group(tube, name)
        parts.append(tube)
        foot_obj = add_uv_sphere(name + "_foot", foot_r, 7, 4, foot_c)
        set_material(foot_obj, mats["leg"])
        assign_group(foot_obj, name)
        parts.append(foot_obj)
        bones_legs.append((name, "body", hip, foot_c))

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

    Two alternating groups of four legs, plus a slight body bob and a
    little claw bounce, so the gait reads even at a glance.
    """
    action = ensure_action(arm, "walk", WALK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")

    group_a = ("leg_L1", "leg_L3", "leg_R2", "leg_R4")
    group_b = ("leg_L2", "leg_L4", "leg_R1", "leg_R3")
    lift = math.radians(22)
    # Reach along +X: the sign flips with the side so both sides step the same way.
    reach = math.radians(16)

    def side_of(name):
        return 1 if "_L" in name else -1

    def pose_for(name, phase):
        s = side_of(name)
        # Local Z swings the foot along the body; local X lifts.
        # Local Y (along the bone) is unused. A signed Z combined with a
        # little extra X-adjacent reach sends the foot along +X.
        if phase == "plant_lead":
            return (0.0, 0.0, s * reach * 0.7)
        if phase == "plant_trail":
            return (0.0, 0.0, -s * reach * 0.7)
        if phase == "swing_mid":
            return (lift, 0.0, s * reach)
        return (0.0, 0.0, 0.0)

    # For a +X scuttle, "lead" is toward +X. Signs were chosen so a first
    # preview can be judged; the fix pass can invert them if needed.
    keys_a = {0: "plant_lead", 6: "plant_trail", 9: "swing_mid", 12: "plant_lead"}
    keys_b = {0: "plant_trail", 3: "swing_mid", 6: "plant_lead", 12: "plant_trail"}
    for name in group_a:
        pb = arm.pose.bones[name]
        for fr, phase in keys_a.items():
            key_euler(pb, fr, pose_for(name, phase))
    for name in group_b:
        pb = arm.pose.bones[name]
        for fr, phase in keys_b.items():
            key_euler(pb, fr, pose_for(name, phase))

    pb = arm.pose.bones["body"]
    key_euler(pb, 0, (0, 0, 0))
    key_euler(pb, 3, (math.radians(3), 0, math.radians(2)))
    key_euler(pb, 6, (0, 0, 0))
    key_euler(pb, 9, (math.radians(3), 0, math.radians(-2)))
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
        (12, (math.radians(10), 0, math.radians(8))),
        (28, (math.radians(-6), 0, math.radians(-4))),
        (48, (0, 0, 0)),
    ])
    twitch("eye_R", [
        (0, (0, 0, 0)),
        (16, (math.radians(-8), 0, math.radians(-6))),
        (32, (math.radians(9), 0, math.radians(5))),
        (48, (0, 0, 0)),
    ])
    # Larger claw (claw_R) waves; its pincher opens and closes a little.
    twitch("claw_R", [
        (0, (0, 0, 0)),
        (14, (math.radians(-12), 0, math.radians(10))),
        (26, (math.radians(-6), 0, math.radians(16))),
        (38, (math.radians(-10), 0, math.radians(8))),
        (48, (0, 0, 0)),
    ])
    twitch("claw_R_pin", [
        (0, (0, 0, 0)),
        (14, (math.radians(16), 0, 0)),
        (26, (math.radians(-8), 0, 0)),
        (38, (math.radians(10), 0, 0)),
        (48, (0, 0, 0)),
    ])
    twitch("claw_L_pin", [
        (0, (0, 0, 0)),
        (24, (math.radians(8), 0, 0)),
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
    key_euler(pb, 3, (math.radians(-8), 0, math.radians(6)))
    key_euler(pb, 6, (math.radians(-4), 0, math.radians(2)))
    key_euler(pb, 10, (0, 0, 0))
    key_euler(pin, 0, (0, 0, 0))
    key_euler(pin, 2, (math.radians(22), 0, 0))   # open
    key_euler(pin, 5, (math.radians(-18), 0, 0))  # snap shut
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
    vs.exposure = 0.0
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
    cam_data.lens = 50
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
    view_34 = ((11.5, -13.5, 7.2), (0.0, -0.4, 1.15))
    view_side = ((14.8, 1.2, 4.6), (0.0, -0.8, 1.15))
    PREVIEW_REPO.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_WORKSPACE.parent.mkdir(parents=True, exist_ok=True)
    _shot(PREVIEW_REPO, *view_34, "idle", 0)
    shutil.copy2(PREVIEW_REPO, PREVIEW_WORKSPACE)
    _shot(PREVIEW_SIDE, *view_side, "idle", 0)
    shutil.copy2(PREVIEW_SIDE, PREVIEW_REPO_SIDE)
    for fr in (0, 3, 6, 9):
        _shot(Path(f"/tmp/crab-walk-side-{fr}.png"), *view_side, "walk", fr)
    _shot(Path("/tmp/crab-snap.png"), *view_34, "snap", 5)

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
    if tris == 0 or tris > 2500:
        raise SystemExit(f"triangle count {tris} out of range (1–2500)")
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
        "leg": make_mat("CrabLeg", LEG, roughness=0.60, metallic=0.0),
        "eye": make_mat("CrabEye", EYE, roughness=0.18, metallic=0.0),
        "highlight": make_mat("CrabHighlight", HIGHLIGHT, roughness=0.25, metallic=0.0, emission=0.35),
    }
    parts, bones = build_meshes(mats)
    mesh = join_objects("Crab", parts)
    tris = triangle_count(mesh)
    print(f"joined mesh triangles: {tris}")
    if tris > 2500:
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
