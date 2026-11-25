"""Build the Octoventure soft-toon ant and export src/assets/models/ant.glb.

The game imports that file (not a public/ URL) so the single-file build inlines it.
Run from the repo (or anywhere) with:
    /opt/blender/blender -b --python tools/blender/ant.py

Scale
-----
The game's blue-ringed octopus is 20 cm and is drawn 0.63 world units long
(CONFIG.octopus.size 0.42 x a 1.5 u model; DESIGN.md: 1 u ~ 32 cm).
1 cm = 0.0315 world units (same as placement.TOL). The real ant is 1.2 cm,
so the exported mesh is 0.0378 u long, already in game units. Do not apply
an extra object scale at hookup (the old instanced ant used 1.6 on a
larger procedural mesh).

Orientation
-----------
Modelled in Blender with +Z up and the head toward -Y, which the glTF
exporter (export_yup=True) maps to +Y up, +Z forward — the same convention
as src/world/props.js. Origin is on the ground, between the feet.

Animations
----------
- walk (0.5 s): alternating tripod gait
- idle (2 s): a slight antenna twitch
"""

from __future__ import annotations

import json
import math
import os
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Vector

# ---------------------------------------------------------------------------
# Paths and scale
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[2]
GLB_PATH = ROOT / "src" / "assets" / "models" / "ant.glb"
PREVIEW_REPO = ROOT / "tools" / "blender" / "ant-preview.png"
PREVIEW_WORKSPACE = Path("/workspace/ant-preview.png")
PREVIEW_SIDE = Path("/workspace/ant-preview-side.png")

# 1 cm at octopus scale (20 cm = 0.63 u).
CM = 0.0315
LENGTH_CM = 1.2
EXPORT_LENGTH = LENGTH_CM * CM  # 0.0378 world units

# Colours
BODY = (0xC2 / 255, 0x52 / 255, 0x2D / 255, 1.0)       # #C2522D
BELLY = (0xE8 / 255, 0xA0 / 255, 0x70 / 255, 1.0)      # #E8A070
EYE = (0x1A / 255, 0x1A / 255, 0x1A / 255, 1.0)        # #1a1a1a
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
def build_meshes(mats):
    """Return (parts_with_groups, bone_specs).

    Bone specs: (name, parent, head, tail). Coordinates are game units.
    Head of the ant faces Blender -Y.
    """
    # Proportions in centimetres, then * CM.
    # Length from head front to abdomen back = 1.2 cm.
    head_c = Vector((0.0, -0.52, 0.30)) * CM
    head_r = 0.20 * CM
    thorax_c = Vector((0.0, -0.24, 0.26)) * CM
    thorax_r = 0.10 * CM
    abdomen_c = Vector((0.0, 0.20, 0.28)) * CM
    abdomen_s = Vector((0.20, 0.28, 0.17)) * CM   # half-extents (x, y, z)

    parts = []

    head = add_uv_sphere("head", head_r, 10, 7, head_c)
    set_material(head, mats["body"])
    assign_group(head, "head")
    parts.append(head)

    thorax = add_uv_sphere("thorax", thorax_r, 8, 6, thorax_c)
    set_material(thorax, mats["body"])
    assign_group(thorax, "thorax")
    parts.append(thorax)

    abd = add_uv_sphere("abdomen", 1.0, 10, 8, abdomen_c, scale=abdomen_s)
    set_material(abd, mats["body"])
    assign_group(abd, "abdomen")
    parts.append(abd)

    # Peach-tan patch on the underside / rear of the abdomen, large enough
    # to peek out from a 3/4 view.
    belly_c = Vector((0.0, 0.34, 0.145)) * CM
    belly_s = Vector((0.155, 0.20, 0.11)) * CM
    belly = add_uv_sphere("belly", 1.0, 8, 6, belly_c, scale=belly_s)
    set_material(belly, mats["belly"])
    assign_group(belly, "abdomen")
    parts.append(belly)

    # Eyes: large glossy black ovals on the front-sides of the head.
    # Head faces -Y; eyes sit slightly out, forward and a tad up.
    for side, name in ((1, "eye_L"), (-1, "eye_R")):
        loc = Vector((side * 0.11, -0.66, 0.34)) * CM
        scl = Vector((0.075, 0.065, 0.090)) * CM
        eye = add_uv_sphere(name, 1.0, 8, 6, loc, scale=scl)
        set_material(eye, mats["eye"])
        assign_group(eye, "head")
        parts.append(eye)
        # Small white catchlight: a tiny sphere centred just inside the
        # ellipsoid so only a bright cap sits on the upper-front of the eye.
        direction = Vector((side * 0.35, -0.75, 0.55)).normalized()
        surface = loc + Vector((scl.x * direction.x, scl.y * direction.y, scl.z * direction.z))
        hl_r = 0.016 * CM
        hloc = surface - direction * (hl_r * 0.45)
        hl = add_uv_sphere(name + "_hl", hl_r, 6, 4, hloc)
        set_material(hl, mats["highlight"])
        assign_group(hl, "head")
        parts.append(hl)

    # Antennae: curve up and slightly back from the top of the head.
    antenna_tips = {}
    for side, name, bone in ((1, "ant_L", "ant_L"), (-1, "ant_R", "ant_R")):
        pts = [
            Vector((side * 0.04, -0.54, 0.48)) * CM,
            Vector((side * 0.07, -0.42, 0.68)) * CM,
            Vector((side * 0.08, -0.30, 0.80)) * CM,
        ]
        tube = curve_tube(name, pts, 0.014 * CM, reso_u=4, bevel_res=1)
        set_material(tube, mats["body"])
        assign_group(tube, bone)
        parts.append(tube)
        tip_c = pts[-1]
        tip = add_uv_sphere(name + "_tip", 0.032 * CM, 6, 4, tip_c)
        set_material(tip, mats["body"])
        assign_group(tip, bone)
        parts.append(tip)
        antenna_tips[bone] = (pts[0], tip_c)

    # Six short chunky legs, three each side, feet on the ground.
    # Each hip is a small coxa sphere seated slightly inside the thorax
    # surface (weighted to the thorax bone) so the legs stay attached in
    # rest and through the walk cycle. Tube and foot thickness are unchanged.
    # Foot sphere centre is at radius height so the underside sits on z = 0.
    foot_r = 0.045 * CM
    leg_r = 0.034 * CM
    coxa_r = 0.046 * CM
    # name, side(+x left), aim_y_cm (old hip aim), foot_x_cm, foot_y_cm
    leg_plan = [
        ("leg_LF",  1, -0.34,  0.22, -0.46),
        ("leg_LM",  1, -0.24,  0.26, -0.24),
        ("leg_LH",  1, -0.14,  0.22, -0.02),
        ("leg_RF", -1, -0.34,  0.22, -0.46),
        ("leg_RM", -1, -0.24,  0.26, -0.24),
        ("leg_RH", -1, -0.14,  0.22, -0.02),
    ]
    bones_legs = []
    for name, side, hip_y, foot_x, foot_y in leg_plan:
        aim = Vector((side * 0.10, hip_y, 0.195)) * CM
        direction = aim - thorax_c
        if direction.length < 1e-9:
            direction = Vector((side, 0.0, 0.0))
        direction.normalize()
        # Slightly inside the thorax so the coxa stays embedded at walk extremes.
        hip = thorax_c + direction * (thorax_r * 0.82)
        foot = Vector((side * foot_x, foot_y, 0.0)) * CM
        foot_c = Vector((foot.x, foot.y, foot_r))
        coxa = add_uv_sphere(name + "_coxa", coxa_r, 6, 3, hip)
        set_material(coxa, mats["body"])
        assign_group(coxa, "thorax")
        parts.append(coxa)
        # Tube starts at the hip (inside the coxa) and stops at the top of the foot.
        toward = (foot_c - hip).normalized()
        shin_end = foot_c - toward * (foot_r * 0.55)
        tube = add_cylinder_between(name, hip, shin_end, leg_r, verts=6)
        set_material(tube, mats["body"])
        assign_group(tube, name)
        parts.append(tube)
        foot_obj = add_uv_sphere(name + "_foot", foot_r, 8, 6, foot_c)
        set_material(foot_obj, mats["body"])
        assign_group(foot_obj, name)
        parts.append(foot_obj)
        bones_legs.append((name, "thorax", hip, foot_c))

    # Armature layout (head, tail) in world space.
    root_tail = Vector((0.0, 0.0, 0.08)) * CM
    bones = [
        ("root", None, Vector((0.0, 0.0, 0.0)), root_tail),
        ("thorax", "root", thorax_c + Vector((0, 0, -0.02 * CM)), thorax_c + Vector((0, 0, 0.06 * CM))),
        ("head", "thorax", head_c, head_c + Vector((0.0, -0.16, 0.0)) * CM),
        ("abdomen", "thorax", abdomen_c, abdomen_c + Vector((0.0, 0.20, 0.0)) * CM),
        ("ant_L", "head", antenna_tips["ant_L"][0], antenna_tips["ant_L"][1]),
        ("ant_R", "head", antenna_tips["ant_R"][0], antenna_tips["ant_R"][1]),
    ]
    bones.extend(bones_legs)
    return parts, bones


def build_armature(bones):
    data = bpy.data.armatures.new("AntArmature")
    data.display_type = "OCTAHEDRAL"
    arm = bpy.data.objects.new("AntArmature", data)
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
    """Subtle antenna twitch, 2 s loop, plus a very slight abdomen settle."""
    action = ensure_action(arm, "idle", IDLE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")

    def twitch(name, frames):
        pb = arm.pose.bones[name]
        for fr, euler in frames:
            key_euler(pb, fr, euler)

    # Phase-offset twitches on each antenna (local X/Z, a few degrees).
    twitch("ant_L", [
        (0, (0, 0, 0)),
        (10, (math.radians(8), 0, math.radians(6))),
        (22, (math.radians(-3), 0, math.radians(-4))),
        (34, (math.radians(5), 0, math.radians(3))),
        (48, (0, 0, 0)),
    ])
    twitch("ant_R", [
        (0, (0, 0, 0)),
        (8, (math.radians(-4), 0, math.radians(-5))),
        (20, (math.radians(7), 0, math.radians(5))),
        (36, (math.radians(-2), 0, math.radians(2))),
        (48, (0, 0, 0)),
    ])
    pb = arm.pose.bones["abdomen"]
    key_euler(pb, 0, (0, 0, 0))
    key_euler(pb, 24, (math.radians(2.5), 0, 0))
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
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 600
    scene.render.resolution_y = 600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.filepath = str(PREVIEW_REPO)

    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.studio_light = "forest.sl" if "forest.sl" in [""] else shading.studio_light
    shading.color_type = "MATERIAL"
    shading.show_shadows = False
    shading.show_cavity = True
    shading.cavity_type = "WORLD"
    shading.cavity_ridge_factor = 0.15
    shading.cavity_valley_factor = 0.25
    shading.use_world_space_lighting = True
    # Brighter studio so the rust-orange body reads as #C2522D, not chocolate.
    if hasattr(shading, "studio_light"):
        for cand in ("outdoor.sl", "plain.sl", "studio.sl", "Default"):
            try:
                shading.studio_light = cand
                break
            except Exception:
                pass

    world = bpy.data.worlds.new("AntPreviewWorld") if "AntPreviewWorld" not in bpy.data.worlds else bpy.data.worlds["AntPreviewWorld"]
    world.use_nodes = False
    world.color = (0.95, 0.92, 0.86)
    scene.world = world
    if hasattr(shading, "background_type"):
        shading.background_type = "WORLD"
    if hasattr(shading, "background_color"):
        shading.background_color = (0.95, 0.92, 0.86)

    # 3/4 view, slightly above, looking toward the head (which faces -Y).
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 70
    cam_data.clip_start = 0.001
    cam_data.clip_end = 10
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    # Frame a 1.2 cm ant: camera about 4–5 cm away.
    cam.location = Vector((3.4, -2.4, 1.25)) * CM
    bpy.context.collection.objects.link(cam)
    scene.camera = cam

    target = look_at if look_at is not None else Vector((0.0, -0.10, 0.28)) * CM
    direction = target - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    # A couple of lights (Workbench uses studio lighting; these help if
    # someone switches the script to Eevee later).
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
        import subprocess
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
        scene.frame_set(frame)
        if arm.animation_data:
            arm.animation_data.action = bpy.data.actions.get(action_name)
            # Re-apply so the pose updates after switching actions.
            scene.frame_set(frame)
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        _composite_cream(path, path)
        print("preview:", path)

    # Same 3/4 camera as before, rest pose.
    view_34 = ((3.4, -2.4, 1.25), (0.0, -0.10, 0.28))
    view_side = ((4.4, -0.12, 1.15), (0.0, -0.10, 0.28))
    PREVIEW_REPO.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW_WORKSPACE.parent.mkdir(parents=True, exist_ok=True)
    _shot(PREVIEW_REPO, *view_34, "idle", 0)
    import shutil
    shutil.copy2(PREVIEW_REPO, PREVIEW_WORKSPACE)
    _shot(PREVIEW_SIDE, *view_side, "idle", 0)
    # Walk extremes, side-on, for a gap check (not committed).
    for fr in (0, 3, 6, 9):
        _shot(Path(f"/tmp/ant-walk-side-{fr}.png"), *view_side, "walk", fr)

    # Don't export the camera or lights.
    for name in ("PreviewCam", "Key", "Fill"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)


# ---------------------------------------------------------------------------
# Export + inspect
# ---------------------------------------------------------------------------
def export_glb():
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Clear any leftover action so export uses stored actions.
    arm = bpy.data.objects.get("AntArmature")
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
    if tris == 0 or tris > 2000:
        raise SystemExit(f"triangle count {tris} out of range (1–2000)")
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
        "body": make_mat("AntBody", BODY, roughness=0.85, metallic=0.0),
        "belly": make_mat("AntBelly", BELLY, roughness=0.85, metallic=0.0),
        "eye": make_mat("AntEye", EYE, roughness=0.18, metallic=0.0),
        "highlight": make_mat("AntHighlight", HIGHLIGHT, roughness=0.25, metallic=0.0, emission=0.35),
    }
    parts, bones = build_meshes(mats)
    mesh = join_objects("Ant", parts)
    tris = triangle_count(mesh)
    print(f"joined mesh triangles: {tris}")
    if tris > 2000:
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
