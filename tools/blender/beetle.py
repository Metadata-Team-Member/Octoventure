"""Build the Octoventure soft-toon beetle and export public/models/beetle.glb.

Run from the repo (or anywhere) with:
    /opt/blender/blender -b --python tools/blender/beetle.py

Style
-----
A cheerful ladybird-style garden beetle: cheerful saturated red-orange elytra with soft
round charcoal spots, a dark pronotum with cream patches, and a subtle centre
seam. Chosen instead of a Christmas-beetle gold-green so the shell and
spots stay high-contrast for colour-blind players (lightness contrast,
not green-on-gold).

Scale
-----
The game's blue-ringed octopus is 20 cm and is drawn 0.63 world units long
(CONFIG.octopus.size 0.42 x a 1.5 u model; DESIGN.md: 1 u ~ 32 cm).
1 cm = 0.0315 world units (same as placement.TOL). This beetle is 1.4 cm,
so the exported mesh is 0.0441 u long, already in game units. Use scale
1.0 at hookup (the current procedural gather beetle is a much larger
~6–8 cm green shell; see the module comment in gatherModels.js).

Orientation
-----------
Modelled in Blender with +Z up and the head toward -Y, which the glTF
exporter (export_yup=True) maps to +Y up, +Z forward — the same convention
as src/world/props.js. Origin is on the ground, between the feet.

Animations
----------
- walk (0.5 s): alternating tripod gait
- idle (2 s): antenna twitch and a tiny elytra flutter
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
GLB_PATH = ROOT / "public" / "models" / "beetle.glb"
PREVIEW_REPO = ROOT / "tools" / "blender" / "beetle-preview.png"
PREVIEW_REPO_SIDE = ROOT / "tools" / "blender" / "beetle-preview-side.png"
PREVIEW_WORKSPACE = Path("/workspace/beetle-preview.png")
PREVIEW_SIDE = Path("/workspace/beetle-preview-side.png")

# 1 cm at octopus scale (20 cm = 0.63 u).
CM = 0.0315
LENGTH_CM = 1.4
EXPORT_LENGTH = LENGTH_CM * CM  # 0.0441 world units

# Colours: ladybird red-orange with charcoal spots (high lightness contrast).
SHELL = (0xFF / 255, 0x5A / 255, 0x2A / 255, 1.0)       # #FF5A2A
SEAM = (0xE8 / 255, 0x3C / 255, 0x20 / 255, 1.0)        # #E83C20
SPOT = (0x2A / 255, 0x22 / 255, 0x1C / 255, 1.0)        # #2A221C
CREAM = (0xF3 / 255, 0xE6 / 255, 0xC8 / 255, 1.0)       # #F3E6C8
BELLY = (0x3D / 255, 0x2A / 255, 0x24 / 255, 1.0)       # #3D2A24
EYE = (0x1A / 255, 0x1A / 255, 0x1A / 255, 1.0)         # #1a1a1a
HIGHLIGHT = (1.0, 1.0, 1.0, 1.0)

FPS = 24
WALK_FRAMES = 12          # 0.5 s
IDLE_FRAMES = 48          # 2.0 s


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
def on_ellipsoid(center, half, direction, embed=1.0):
    d = Vector(direction)
    if d.length < 1e-9:
        d = Vector((0.0, 0.0, 1.0))
    d.normalize()
    return Vector(center) + Vector((half.x * d.x, half.y * d.y, half.z * d.z)) * embed


def build_meshes(mats):
    """Return (parts_with_groups, bone_specs). Head faces Blender -Y."""
    head_c = Vector((0.0, -0.55, 0.28)) * CM
    head_r = 0.16 * CM
    pronotum_c = Vector((0.0, -0.32, 0.33)) * CM
    pronotum_s = Vector((0.24, 0.16, 0.12)) * CM
    elytra_c = Vector((0.0, 0.18, 0.40)) * CM
    elytra_s = Vector((0.34, 0.52, 0.26)) * CM
    thorax_c = Vector((0.0, -0.14, 0.24)) * CM
    thorax_r = 0.155 * CM

    parts = []

    # Hidden-ish thorax bead the coxae sit in (peeks at the sides/underside).
    thorax = add_uv_sphere("thorax", thorax_r, 8, 6, thorax_c)
    set_material(thorax, mats["spot"])
    assign_group(thorax, "thorax")
    parts.append(thorax)

    head = add_uv_sphere("head", head_r, 12, 7, head_c)
    set_material(head, mats["spot"])
    assign_group(head, "head")
    parts.append(head)

    pron = add_uv_sphere("pronotum", 1.0, 10, 6, pronotum_c, scale=pronotum_s)
    set_material(pron, mats["spot"])
    assign_group(pron, "thorax")
    parts.append(pron)

    # Soft cream patches on the pronotum: neat rounded discs, slightly inset.
    for side in (1, -1):
        direction = Vector((side * 0.85, -0.15, 0.45))
        surface = on_ellipsoid(pronotum_c, pronotum_s, direction, 1.0)
        normal = ellipsoid_normal(pronotum_c, pronotum_s, surface)
        patch = add_surface_disc(
            f"pron_patch_{side}", surface, normal, 0.058 * CM,
            thickness=0.32, segments=12, rings=3, inset=0.14,
        )
        set_material(patch, mats["cream"])
        assign_group(patch, "thorax")
        parts.append(patch)

    elytra = add_uv_sphere("elytra", 1.0, 12, 8, elytra_c, scale=elytra_s)
    set_material(elytra, mats["shell"])
    assign_group(elytra, "abdomen")
    parts.append(elytra)

    # Subtle centre seam along the top ridge of the elytra.
    seam_pts = []
    for t in (-0.82, -0.45, 0.0, 0.45, 0.82):
        y = elytra_c.y + elytra_s.y * t
        z = elytra_c.z + elytra_s.z * math.sqrt(max(0.0, 1.0 - t * t)) * 0.98
        seam_pts.append(Vector((0.0, y, z)))
    seam = curve_tube("seam", seam_pts, 0.011 * CM, reso_u=4, bevel_res=1)
    set_material(seam, mats["seam"])
    assign_group(seam, "abdomen")
    parts.append(seam)

    # Soft dark spots: smooth discs that follow the shell, varied sizes,
    # mirrored across the centre seam, slightly inset to avoid z-fighting.
    spot_spec = [
        # direction from elytra centre, radius cm
        ((0.72, -0.10, 0.70), 0.090),
        ((0.55, 0.52, 0.60), 0.068),
        ((0.62, -0.55, 0.50), 0.050),
        ((-0.72, -0.10, 0.70), 0.090),
        ((-0.55, 0.52, 0.60), 0.068),
        ((-0.62, -0.55, 0.50), 0.050),
    ]
    for i, (direction, rad_cm) in enumerate(spot_spec):
        surface = on_ellipsoid(elytra_c, elytra_s, direction, 1.0)
        normal = ellipsoid_normal(elytra_c, elytra_s, surface)
        spot = add_surface_disc(
            f"spot_{i}", surface, normal, rad_cm * CM,
            thickness=0.28, segments=16, rings=3, inset=0.12,
        )
        set_material(spot, mats["spot"])
        assign_group(spot, "abdomen")
        parts.append(spot)

    # Warm-dark underside of the shell.
    belly_c = Vector((0.0, 0.22, 0.18)) * CM
    belly_s = Vector((0.24, 0.36, 0.10)) * CM
    belly = add_uv_sphere("belly", 1.0, 8, 6, belly_c, scale=belly_s)
    set_material(belly, mats["belly"])
    assign_group(belly, "abdomen")
    parts.append(belly)

    # Big friendly eyes + white catchlights (same treatment as the ant).
    for side, name in ((1, "eye_L"), (-1, "eye_R")):
        loc = Vector((side * 0.10, -0.66, 0.32)) * CM
        scl = Vector((0.070, 0.060, 0.080)) * CM
        eye = add_uv_sphere(name, 1.0, 8, 6, loc, scale=scl)
        set_material(eye, mats["eye"])
        assign_group(eye, "head")
        parts.append(eye)
        direction = Vector((side * 0.35, -0.75, 0.55)).normalized()
        surface = loc + Vector((scl.x * direction.x, scl.y * direction.y, scl.z * direction.z))
        hl_r = 0.016 * CM
        hloc = surface - direction * (hl_r * 0.45)
        hl = add_uv_sphere(name + "_hl", hl_r, 6, 4, hloc)
        set_material(hl, mats["highlight"])
        assign_group(hl, "head")
        parts.append(hl)

    # Short clubbed antennae.
    antenna_tips = {}
    for side, name, bone in ((1, "ant_L", "ant_L"), (-1, "ant_R", "ant_R")):
        pts = [
            Vector((side * 0.07, -0.62, 0.38)) * CM,
            Vector((side * 0.13, -0.72, 0.48)) * CM,
            Vector((side * 0.15, -0.78, 0.50)) * CM,
        ]
        tube = curve_tube(name, pts, 0.012 * CM, reso_u=3, bevel_res=1)
        set_material(tube, mats["spot"])
        assign_group(tube, bone)
        parts.append(tube)
        tip_c = pts[-1]
        club = add_uv_sphere(name + "_club", 0.038 * CM, 6, 4, tip_c)
        set_material(club, mats["spot"])
        assign_group(club, bone)
        parts.append(club)
        antenna_tips[bone] = (pts[0], tip_c)

    # Six chunky legs with coxa hips seated in the thorax, ball feet on the ground.
    foot_r = 0.048 * CM
    leg_r = 0.036 * CM
    coxa_r = 0.050 * CM
    # name, side(+x left), aim_y_cm, foot_x_cm, foot_y_cm
    leg_plan = [
        ("leg_LF",  1, -0.32,  0.24, -0.50),
        ("leg_LM",  1, -0.14,  0.28, -0.16),
        ("leg_LH",  1,  0.02,  0.25,  0.14),
        ("leg_RF", -1, -0.32,  0.24, -0.50),
        ("leg_RM", -1, -0.14,  0.28, -0.16),
        ("leg_RH", -1,  0.02,  0.25,  0.14),
    ]
    bones_legs = []
    for name, side, hip_y, foot_x, foot_y in leg_plan:
        aim = Vector((side * 0.14, hip_y, 0.16)) * CM
        direction = aim - thorax_c
        if direction.length < 1e-9:
            direction = Vector((side, 0.0, 0.0))
        direction.normalize()
        hip = thorax_c + direction * (thorax_r * 0.82)
        foot = Vector((side * foot_x, foot_y, 0.0)) * CM
        foot_c = Vector((foot.x, foot.y, foot_r))
        coxa = add_uv_sphere(name + "_coxa", coxa_r, 6, 3, hip)
        set_material(coxa, mats["spot"])
        assign_group(coxa, "thorax")
        parts.append(coxa)
        toward = (foot_c - hip).normalized()
        shin_end = foot_c - toward * (foot_r * 0.55)
        tube = add_cylinder_between(name, hip, shin_end, leg_r, verts=6)
        set_material(tube, mats["spot"])
        assign_group(tube, name)
        parts.append(tube)
        foot_obj = add_uv_sphere(name + "_foot", foot_r, 6, 4, foot_c)
        set_material(foot_obj, mats["spot"])
        assign_group(foot_obj, name)
        parts.append(foot_obj)
        bones_legs.append((name, "thorax", hip, foot_c))

    root_tail = Vector((0.0, 0.0, 0.08)) * CM
    bones = [
        ("root", None, Vector((0.0, 0.0, 0.0)), root_tail),
        ("thorax", "root", thorax_c + Vector((0, 0, -0.02 * CM)), thorax_c + Vector((0, 0, 0.08 * CM))),
        ("head", "thorax", head_c, head_c + Vector((0.0, -0.14, 0.0)) * CM),
        ("abdomen", "thorax", elytra_c, elytra_c + Vector((0.0, 0.28, 0.0)) * CM),
        ("ant_L", "head", antenna_tips["ant_L"][0], antenna_tips["ant_L"][1]),
        ("ant_R", "head", antenna_tips["ant_R"][0], antenna_tips["ant_R"][1]),
    ]
    bones.extend(bones_legs)
    return parts, bones


def build_armature(bones):
    data = bpy.data.armatures.new("BeetleArmature")
    data.display_type = "OCTAHEDRAL"
    arm = bpy.data.objects.new("BeetleArmature", data)
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
    """Alternating tripod gait, 0.5 s loop.

    Group A (LF, RM, LH) swings 0 → 6, planted 6 → 12.
    Group B (RF, LM, RH) planted 0 → 6, swings 6 → 12.
    """
    action = ensure_action(arm, "walk", WALK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")

    group_a = ("leg_LF", "leg_RM", "leg_LH")
    group_b = ("leg_RF", "leg_LM", "leg_RH")

    # Local rotations on a bone that points hip → foot (along +Y).
    # X = lift (positive raises the foot for a typical side-pointing leg),
    # Z = swing along the body.
    # Because left and right legs point opposite ways in world X, the
    # local swing sign is flipped per side so both sides step forward
    # (toward the head, -Y).
    lift = math.radians(28)
    swing = math.radians(22)

    def side_of(name):
        return 1 if name.endswith(("LF", "LM", "LH")) else -1

    def pose_for(name, phase):
        """phase: 'plant_fwd', 'plant_back', 'swing_mid'."""
        s = side_of(name)
        # Left legs: +Z swing moves the foot toward -Y (forward) or not —
        # we key both sides with a consistent 'forward' meaning: foot toward head.
        # Empirically, a +Z rotation on a bone along hip→foot with +Y bone
        # axis needs a per-side sign. We set it, then the preview will tell us.
        if phase == "plant_fwd":
            return (0.0, 0.0, s * swing * 0.85)
        if phase == "plant_back":
            return (0.0, 0.0, -s * swing * 0.85)
        if phase == "swing_mid":
            return (lift, 0.0, s * swing)
        return (0.0, 0.0, 0.0)

    # Frames: 0 ident to 12. Mid-swing at 3 (A) and 9 (B).
    # A: 0 plant_fwd, 3 swing? No — A swings 0-6: 0 plant_back (push off),
    # 3 mid-swing going forward, 6 plant_fwd, 12 plant_back.
    # Standard: at t=0 A has just planted forward, then it pushes back
    # (stance) until t=6 when B has planted; A then swings forward.
    # So A: 0 plant_fwd, 6 plant_back, 9 swing_mid, 12 plant_fwd.
    # B: 0 plant_back, 3 swing_mid, 6 plant_fwd, 12 plant_back.
    keys_a = {0: "plant_fwd", 6: "plant_back", 9: "swing_mid", 12: "plant_fwd"}
    keys_b = {0: "plant_back", 3: "swing_mid", 6: "plant_fwd", 12: "plant_back"}

    for name in group_a:
        pb = arm.pose.bones[name]
        for fr, phase in keys_a.items():
            key_euler(pb, fr, pose_for(name, phase))
    for name in group_b:
        pb = arm.pose.bones[name]
        for fr, phase in keys_b.items():
            key_euler(pb, fr, pose_for(name, phase))

    # A tiny body bob so the walk reads at a glance in the clip.
    for bone_name, amp in (("thorax", math.radians(3)), ("abdomen", math.radians(4))):
        pb = arm.pose.bones[bone_name]
        key_euler(pb, 0, (0.0, 0.0, 0.0))
        key_euler(pb, 3, (amp, 0.0, 0.0))
        key_euler(pb, 6, (0.0, 0.0, 0.0))
        key_euler(pb, 9, (amp, 0.0, 0.0))
        key_euler(pb, 12, (0.0, 0.0, 0.0))

    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "walk")
    return action



def animate_idle(arm):
    """Antenna twitch plus a tiny elytra flutter, 2 s loop."""
    action = ensure_action(arm, "idle", IDLE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")

    def twitch(name, frames):
        pb = arm.pose.bones[name]
        for fr, euler in frames:
            key_euler(pb, fr, euler)

    twitch("ant_L", [
        (0, (0, 0, 0)),
        (10, (math.radians(10), 0, math.radians(8))),
        (22, (math.radians(-4), 0, math.radians(-5))),
        (34, (math.radians(6), 0, math.radians(4))),
        (48, (0, 0, 0)),
    ])
    twitch("ant_R", [
        (0, (0, 0, 0)),
        (8, (math.radians(-6), 0, math.radians(-6))),
        (20, (math.radians(9), 0, math.radians(6))),
        (36, (math.radians(-3), 0, math.radians(3))),
        (48, (0, 0, 0)),
    ])
    # A very small lift/settle of the shell, like a breath or flutter.
    pb = arm.pose.bones["abdomen"]
    key_euler(pb, 0, (0, 0, 0))
    key_euler(pb, 16, (math.radians(-3.5), 0, 0))
    key_euler(pb, 32, (math.radians(1.5), 0, 0))
    key_euler(pb, 48, (0, 0, 0))

    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "idle")
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
def render_preview(arm, look_at=None):
    scene = bpy.context.scene
    # Standard/sRGB so saturated toon reds stay cheerful; AgX/Filmic browns them.
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

    # Workbench is reliable headless. Standard view (set above) keeps the
    # red cheerful; AgX was muting it to a dusty brown.
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
                break
            except Exception:
                pass
    print("preview engine:", scene.render.engine, "view_transform:", vs.view_transform)

    world = bpy.data.worlds.new("BeetlePreviewWorld") if "BeetlePreviewWorld" not in bpy.data.worlds else bpy.data.worlds["BeetlePreviewWorld"]
    world.use_nodes = False
    world.color = (0.95, 0.92, 0.86)
    scene.world = world
    if hasattr(shading, "background_type"):
        shading.background_type = "WORLD"
    if hasattr(shading, "background_color"):
        shading.background_color = (0.95, 0.92, 0.86)

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 70
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

    add_light("Key", "SUN", (3, -4, 6), 2.0, (1.0, 0.97, 0.92))
    add_light("Fill", "AREA", (-4, -2, 3), 40.0, (0.85, 0.9, 1.0))

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

    view_34 = ((3.6, -2.6, 1.40), (0.0, 0.00, 0.32))
    view_side = ((4.8, -0.05, 1.25), (0.0, 0.00, 0.32))
    PREVIEW_REPO.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_WORKSPACE.parent.mkdir(parents=True, exist_ok=True)
    _shot(PREVIEW_REPO, *view_34, "idle", 0)
    shutil.copy2(PREVIEW_REPO, PREVIEW_WORKSPACE)
    _shot(PREVIEW_SIDE, *view_side, "idle", 0)
    shutil.copy2(PREVIEW_SIDE, PREVIEW_REPO_SIDE)
    for fr in (0, 3, 6, 9):
        _shot(Path(f"/tmp/beetle-walk-side-{fr}.png"), *view_side, "walk", fr)

    for name in ("PreviewCam", "Key", "Fill"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)


def export_glb():
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Clear any leftover action so export uses stored actions.
    arm = bpy.data.objects.get("BeetleArmature")
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
    if tris == 0 or tris > 2200:
        raise SystemExit(f"triangle count {tris} out of range (1–2200)")
    missing = [n for n in ("walk", "idle") if n not in anims]
    if missing:
        # Some exporters prefix or suffix the action name; show what we got.
        lower = {a.lower() for a in anims}
        if not missing or ({"walk", "idle"} <= lower):
            print("animation names are present with different casing:", anims)
        else:
            raise SystemExit(f"missing animations {missing}; have {anims}")
    if box:
        # After Y-up conversion, length should be along Z.
        length_z = box["size"][2]
        length_max = max(box["size"])
        print(f"length along Z={length_z:.5f} u, longest axis={length_max:.5f} u, expected={expected_length:.5f} u")
        if abs(length_max - expected_length) / expected_length > 0.25:
            print("WARNING: exported length is more than 25% off the 1.2 cm target")
        if box["min"][1] < -0.005:
            print("WARNING: mesh extends well below the ground (Y min =", box["min"][1], ")")
    return report



def main():
    clear_scene()
    mats = {
        "shell": set_coat(make_mat("BeetleShell", SHELL, roughness=0.34, metallic=0.0), 0.38, 0.16),
        "seam": make_mat("BeetleSeam", SEAM, roughness=0.40, metallic=0.0),
        "spot": make_mat("BeetleSpot", SPOT, roughness=0.80, metallic=0.0),
        "cream": make_mat("BeetleCream", CREAM, roughness=0.75, metallic=0.0),
        "belly": make_mat("BeetleBelly", BELLY, roughness=0.85, metallic=0.0),
        "eye": make_mat("BeetleEye", EYE, roughness=0.18, metallic=0.0),
        "highlight": make_mat("BeetleHighlight", HIGHLIGHT, roughness=0.25, metallic=0.0, emission=0.35),
    }
    parts, bones = build_meshes(mats)
    mesh = join_objects("Beetle", parts)
    tris = triangle_count(mesh)
    print(f"joined mesh triangles: {tris}")
    if tris > 2200:
        raise SystemExit(f"too many triangles: {tris}")
    arm = build_armature(bones)
    bind(mesh, arm)
    animate_walk(arm)
    animate_idle(arm)
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
