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
from mathutils import Vector

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
BODY = (0xE8 / 255, 0xB2 / 255, 0x3A / 255, 1.0)        # #E8B23A
BELLY = (0xF6 / 255, 0xE4 / 255, 0xB8 / 255, 1.0)       # #F6E4B8
RING = (0x2E / 255, 0x7B / 255, 0xFF / 255, 1.0)        # #2E7BFF
RING_EDGE = (0x0A / 255, 0x1C / 255, 0x66 / 255, 1.0)   # #0A1C66
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



def add_annulus(name, center, normal, inner, outer, thickness, segments=12):
    """A thin open ring (annulus) in a plane, axis along `normal`."""
    n = Vector(normal)
    if n.length < 1e-9:
        n = Vector((0.0, 0.0, 1.0))
    n.normalize()
    verts = []
    th = thickness * 0.5
    for zsign in (-1.0, 1.0):
        for i in range(segments):
            a = (i / segments) * 2.0 * math.pi
            c, s = math.cos(a), math.sin(a)
            verts.append((outer * c, outer * s, zsign * th))
            verts.append((inner * c, inner * s, zsign * th))

    def vi(layer, i, which):
        return layer * segments * 2 + i * 2 + which

    faces = []
    for i in range(segments):
        j = (i + 1) % segments
        faces.append((vi(1, i, 0), vi(1, j, 0), vi(1, j, 1), vi(1, i, 1)))
        faces.append((vi(0, i, 0), vi(0, i, 1), vi(0, j, 1), vi(0, j, 0)))
        faces.append((vi(0, i, 0), vi(0, j, 0), vi(1, j, 0), vi(1, i, 0)))
        faces.append((vi(0, i, 1), vi(1, i, 1), vi(1, j, 1), vi(0, j, 1)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(n)
    obj.location = Vector(center) + n * (thickness * 0.55)
    apply_all(obj)
    shade_smooth(obj)
    return obj


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
    """Rest-pose joint positions for one arm in a local frame (out along +X, up +Z)."""
    # 7 joints (6 bones). Total arm length ~ 7.2 cm from the crown, sitting on the ground.
    # span 2 * 7.2 + a little body overlap ≈ 20 cm.
    lengths = (1.35, 1.30, 1.20, 1.15, 1.10, 1.10)  # cm, between joints
    pts = [Vector((0.0, 0.0, 0.0))]
    x = 0.0
    z = 0.0
    for k, length in enumerate(lengths):
        x += length
        # drop quickly onto the ground, then travel, tip curls up a little
        t = (k + 1) / len(lengths)
        if t < 0.28:
            z = 0.0 - (0.0)  # relative to crown; applied later
        pts.append(Vector((x, 0.0, 0.0)))
    # overwrite z in crown space: crown is at z=1.20 cm, ground feet at 0.18 cm
    # We'll place these in world space in build_meshes.
    return pts, lengths


def build_meshes(mats):
    """Return (parts, bones). Face toward Blender -Y."""
    parts = []
    bones = []

    # --- body: rounded mantle + slightly squashed head ---
    mantle_c = Vector((0.0, 1.35, 3.20)) * CM
    mantle_s = Vector((2.70, 2.70, 2.55)) * CM
    head_c = Vector((0.0, -1.15, 2.65)) * CM
    head_s = Vector((2.15, 1.95, 1.70)) * CM

    mantle = add_uv_sphere("mantle", 1.0, 20, 12, mantle_c, scale=mantle_s)
    set_material(mantle, mats["body"])
    assign_group(mantle, "mantle1")
    parts.append(mantle)

    head = add_uv_sphere("head", 1.0, 16, 10, head_c, scale=head_s)
    set_material(head, mats["body"])
    assign_group(head, "head")
    parts.append(head)

    # soft brow ridges above the eyes
    for side, name in ((1, "brow_L"), (-1, "brow_R")):
        loc = Vector((side * 1.05, -2.15, 3.35)) * CM
        brow = add_uv_sphere(name, 1.0, 8, 5, loc, scale=Vector((0.55, 0.28, 0.22)) * CM)
        set_material(brow, mats["body"])
        assign_group(brow, "head")
        parts.append(brow)

    # Beak under the front of the head, at the arm crown.
    beak_c = Vector((0.0, -0.35, 1.35)) * CM
    beak = add_uv_sphere("beak", 1.0, 8, 6, beak_c, scale=Vector((0.35, 0.32, 0.28)) * CM)
    set_material(beak, mats["beak"])
    assign_group(beak, "beak")
    parts.append(beak)

    # Eyes: big, glossy, on the front of the head, with catchlights.
    eye_bones = {}
    for side, name in ((1, "eye_L"), (-1, "eye_R")):
        tip = Vector((side * 1.20, -2.55, 3.05)) * CM
        eye_r = 0.62 * CM
        eye = add_uv_sphere(name, eye_r, 12, 8, tip)
        set_material(eye, mats["eye"])
        assign_group(eye, name)
        parts.append(eye)
        direction = Vector((-side * 0.15, -0.85, 0.28)).normalized()
        surface = tip + direction * eye_r
        hl = add_uv_sphere(name + "_hl", 0.18 * CM, 7, 5, surface - direction * (0.03 * CM))
        set_material(hl, mats["highlight"])
        assign_group(hl, name)
        parts.append(hl)
        eye_bones[name] = (tip + Vector((0, 0.15, 0)) * CM, tip)

    # Rings on the mantle and head (blue disc + slightly larger navy outline).
    def add_ring(tag, center, half, direction, radius_cm, group):
        # Open rings with a navy outline, centre shows the body.
        surface = on_ellipsoid(center, half, direction, 1.0)
        normal = ellipsoid_normal(center, half, surface)
        r = radius_cm * CM
        edge = add_annulus(tag + "_edge", surface, normal, r * 0.52, r * 1.08, 0.07 * CM, 10)
        set_material(edge, mats["ringEdge"])
        assign_group(edge, group)
        parts.append(edge)
        disc = add_annulus(tag, surface + normal * (0.04 * CM), normal, r * 0.62, r * 0.98, 0.08 * CM, 10)
        set_material(disc, mats["rings"])
        assign_group(disc, group)
        parts.append(disc)

    mantle_rings = [
        ((0.20, -0.50, 0.80), 0.48),
        ((0.75, -0.10, 0.50), 0.42),
        ((0.50,  0.55, 0.50), 0.38),
        ((0.80,  0.25, 0.10), 0.36),
        ((-0.20, -0.50, 0.80), 0.48),
        ((-0.75, -0.10, 0.50), 0.42),
        ((-0.50,  0.55, 0.50), 0.38),
        ((-0.80,  0.25, 0.10), 0.36),
        ((0.00,  0.20, 0.98), 0.44),
        ((0.00,  0.85, 0.15), 0.34),
    ]
    for i, (d, rad) in enumerate(mantle_rings):
        add_ring(f"mring_{i}", mantle_c, mantle_s, d, rad, "mantle1")

    head_rings = [
        ((0.85,  0.15, 0.10), 0.30),
        ((0.50,  0.50, 0.35), 0.26),
        ((-0.85,  0.15, 0.10), 0.30),
        ((-0.50,  0.50, 0.35), 0.26),
    ]
    for i, (d, rad) in enumerate(head_rings):
        add_ring(f"hring_{i}", head_c, head_s, d, rad, "head")

    # --- eight arms ---
    crown = Vector((0.0, 0.0, 1.20)) * CM
    # Joint offsets along the arm, in cm, and height in cm (world Z).
    # drop onto the ground, travel, tip curls slightly up.
    # distances from crown along the arm:
    along = [0.0, 1.35, 2.65, 3.85, 5.00, 6.10, 7.20]  # 7 joints
    height = [1.20, 0.85, 0.45, 0.22, 0.18, 0.20, 0.32]  # cm above ground
    radii = [0.85, 0.72, 0.58, 0.45, 0.34, 0.24, 0.16]  # cm, at each joint

    def world_joint(i, k):
        d = arm_dir(i)
        spread = 0.55 * CM  # crown radius
        return Vector((
            d.x * (spread / CM + along[k]) * CM,
            d.y * (spread / CM + along[k]) * CM,
            height[k] * CM,
        ))

    for i in range(N_ARMS):
        d = arm_dir(i)
        joints = [world_joint(i, k) for k in range(ARM_SEGS + 1)]
        names = [arm_bone(i, k) for k in range(ARM_SEGS)]
        # coxa / shoulder, body-weighted so the arm stays seated on the crown
        coxa = add_uv_sphere(f"arm{i}_coxa", radii[0] * 1.05 * CM, 6, 4, joints[0])
        set_material(coxa, mats["body"])
        assign_group(coxa, "body")
        parts.append(coxa)
        for k in range(ARM_SEGS):
            a, b = joints[k], joints[k + 1]
            r0, r1 = radii[k] * CM, radii[k + 1] * CM
            r = 0.5 * (r0 + r1)
            mid = (a + b) * 0.5
            bone = names[k]
            parent = "body" if k == 0 else names[k - 1]
            # tube
            tube = add_cylinder_between(f"arm{i}_t{k}", a, b, r, verts=8)
            set_material(tube, mats["body"])
            assign_group(tube, bone)
            parts.append(tube)
            if k % 2 == 0:
                down = Vector((0.0, 0.0, -1.0))
                belly = add_uv_sphere(
                    f"arm{i}_b{k}", r * 0.72, 6, 4,
                    mid + down * (r * 0.55),
                    scale=Vector((1.05, 1.05, 0.55)),
                )
                set_material(belly, mats["belly"])
                assign_group(belly, bone)
                parts.append(belly)
            if k < ARM_SEGS - 1:
                kn = add_uv_sphere(f"arm{i}_j{k}", r0 * 0.72, 6, 4, b)
                set_material(kn, mats["body"])
                assign_weights(kn, [(bone, 0.55), (names[k + 1], 0.45)])
                parts.append(kn)
            else:
                tip = add_uv_sphere(f"arm{i}_end", r1 * 1.15, 6, 4, b)
                set_material(tip, mats["body"])
                assign_group(tip, bone)
                parts.append(tip)
            if k == 2:
                outward = Vector((d.x, d.y, 0.45)).normalized()
                add_ring(f"aring_{i}_{k}", mid, Vector((r, r, r)), outward, 0.26, bone)
            if k in (1, 3):
                suc = add_uv_sphere(
                    f"arm{i}_s{k}", 0.14 * CM, 6, 4,
                    mid + Vector((0.0, 0.0, -r * 0.85)),
                )
                set_material(suc, mats["sucker"])
                assign_group(suc, bone)
                parts.append(suc)

        # arm bones: parent chain
        for k in range(ARM_SEGS):
            parent = "body" if k == 0 else names[k - 1]
            bones.append((names[k], parent, joints[k], joints[k + 1]))

    # Armature bones for the body
    root_tail = Vector((0.0, 0.0, 0.4)) * CM
    body_head = Vector((0.0, 0.0, 0.5)) * CM
    body_tail = Vector((0.0, 0.0, 1.5)) * CM
    # mantle chain, front to back along +Y (behind the face)
    m0 = Vector((0.0, -0.4, 3.10)) * CM
    m1 = Vector((0.0,  0.9, 3.30)) * CM
    m2 = Vector((0.0,  2.40, 3.10)) * CM
    m3 = Vector((0.0,  3.70, 2.70)) * CM
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
            lift = 18 * max(0.0, wave)
            curl = 0.20 + 0.35 * max(0.0, -wave)
            swing = 16 * math.cos(phase)  # reach / retract along the circle
            key_arm(arm, i, fr, arm_curl(curl, lift=lift, swing=swing, flare=4))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "walk")
    return action


def animate_swim(arm):
    action = ensure_action(arm, "swim", SWIM_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    zero_pose(arm)
    for fr in (0, 7, 14, 21, 28):
        u = fr / SWIM_FRAMES
        jet = 0.5 + 0.5 * math.sin(u * 2 * math.pi)
        # mantle pulses (jet): inflate then squeeze
        key_scale(arm.pose.bones["mantle1"], fr, (1.0 + 0.10 * (1 - jet), 1.0, 0.88 + 0.20 * jet))
        key_scale(arm.pose.bones["mantle2"], fr, (1.0, 1.0, 0.85 + 0.25 * jet))
        key_euler(arm.pose.bones["body"], fr, (math.radians(-8), 0, 0))
        key_euler(arm.pose.bones["head"], fr, (math.radians(-6 + 4 * jet), 0, 0))
        for i in range(N_ARMS):
            # trail behind (toward +Y / export -Z): curl arms backward, slightly spread
            # arm0 is forward; we sweep every arm toward the back.
            # A backward curl is a negative flare for front arms, mixed for sides.
            ang = i * (2 * math.pi / N_ARMS)
            # 0 at front, 1 at back
            back = 0.5 - 0.5 * math.cos(ang)
            wave = 0.25 * math.sin(u * 2 * math.pi + i * 0.5)
            # lift the arms off the ground and stream them back
            lift = 14 + 8 * jet
            side = 1 if math.sin(ang) >= 0 else -1
            swing = (28 + 12 * jet) * (0.3 + 0.7 * (1 - back)) * side * 0.35
            curl = 0.35 + 0.20 * jet + wave
            flare = -32 * (0.25 + 0.75 * (1 - back))  # stream backward
            key_arm(arm, i, fr, arm_curl(curl, lift=lift, swing=swing, flare=flare))
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
        key_euler(arm.pose.bones["body"], fr, (math.radians(-6), 0, 0))
        for i in range(N_ARMS):
            phase = drift * math.sin(i * 0.9 + fr * 0.08)
            # spread in a soft 3D star, slightly lifted off a flat plane
            key_arm(arm, i, fr, arm_curl(0.20 + 0.15 * phase, lift=10 + 4 * phase, flare=6))
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
    vs.exposure = 0.20
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
    view_34 = ((7.0, -16.5, 7.2), (0.0, -0.8, 2.3))
    view_side = ((17.0, 0.3, 5.8), (0.0, -0.4, 2.2))
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
    if tris == 0 or tris > 10500:
        raise SystemExit(f"triangle count {tris} out of range (1–10500)")
    if path.stat().st_size > 1024 * 1024:
        print("WARNING: glb is over 1 MB")
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
        "eye": make_mat("eye", EYE, roughness=0.16, metallic=0.0),
        "highlight": make_mat("highlight", HIGHLIGHT, roughness=0.22, metallic=0.0, emission=0.35),
        "beak": make_mat("beak", BEAK, roughness=0.55, metallic=0.0),
        "sucker": make_mat("sucker", SUCKER, roughness=0.65, metallic=0.0),
    }
    parts, bones = build_meshes(mats)
    mesh = join_objects("Octopus", parts)
    tris = triangle_count(mesh)
    print(f"joined mesh triangles: {tris}")
    if tris > 10500:
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
