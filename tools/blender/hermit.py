"""Build the Octoventure soft-toon hermit crab and export public/models/hermit.glb.

Run from the repo with:
    /opt/blender/blender -b --python tools/blender/hermit.py

Style
-----
A cute Australian shore hermit crab (Coenobita-style) in a spiral sea
shell: warm cream shell with soft caramel spiral banding that reads by
lightness, a bright coral-orange crab peeking from the aperture, one
larger left crusher claw, peach-cream claw tips, two pairs of smooth
walking legs, glossy eyestalks and tiny bent antennae.

Scale
-----
The game's octopus is 20 cm = 0.63 world units (1 cm = 0.0315 u).
This hermit crab is about 8 cm long including the shell (0.252 u).
Use scale 1.0 at hookup. The current procedural hermitGeo is a bit
smaller (~6–7 cm).

Orientation
-----------
Modelled in Blender with +Z up and the aperture / crab face toward -Y,
which the glTF exporter (export_yup=True) maps to +Y up, +Z forward.
Origin is on the ground, under the shell and between the feet.

Walk direction
--------------
The walk clip is an in-place forward crawl along local +Z (no root
motion). Current game code sidles hermits along +X like a ghost crab;
hookup should travel with sin(h) on x and cos(h) on z so the crab
walks aperture-first, shell behind.

Animations
----------
- idle (~2.5 s): antenna twitch, eyestalk bob, subtle shell sway, loop
- walk (~0.62 s): alternating legs, shell bob, loop, no root motion
- hide (~0.42 s): pulls legs, claws and eyes into the shell and lowers
  the shell onto the ground (one-shot)
- peek (~0.62 s): cautiously pokes eyes and claws back out (one-shot)
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
import bmesh
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
GLB_PATH = ROOT / "public" / "models" / "hermit.glb"
PREVIEW_REPO = ROOT / "tools" / "blender" / "hermit-preview.png"
PREVIEW_REPO_SIDE = ROOT / "tools" / "blender" / "hermit-preview-side.png"
PREVIEW_REPO_WALK = ROOT / "tools" / "blender" / "hermit-walk.png"
PREVIEW_REPO_HIDE = ROOT / "tools" / "blender" / "hermit-hide.png"
PREVIEW_WORKSPACE = Path("/workspace/hermit-preview.png")
PREVIEW_SIDE = Path("/workspace/hermit-preview-side.png")
PREVIEW_WALK = Path("/workspace/hermit-walk.png")
PREVIEW_HIDE = Path("/workspace/hermit-hide.png")
SHELL_TEX = ROOT / "tools" / "blender" / "hermit_shell.png"

CM = 0.0315
LENGTH_CM = 8.0
EXPORT_LENGTH = LENGTH_CM * CM  # 0.252 u

# Cream shell, terracotta bands (lightness contrast for colour-blind players).
# Authored a touch bright so Workbench midtones stay vivid.
SHELL_COL = (0xF6 / 255, 0xE4 / 255, 0xC6 / 255, 1.0)   # #F6E4C6 ~ #F2DEC0
BAND_COL = (0xC8 / 255, 0x6E / 255, 0x3E / 255, 1.0)    # #C86E3E ~ #C87A4B
RIM_COL = (0xE8 / 255, 0xC8 / 255, 0x9A / 255, 1.0)     # slightly deeper cream lip
INTERIOR_COL = (0x6A / 255, 0x3E / 255, 0x28 / 255, 1.0)
BODY_COL = (0xFF / 255, 0x6B / 255, 0x3D / 255, 1.0)    # #FF6B3D
CLAW_TIP = (0xF7 / 255, 0xD7 / 255, 0xA8 / 255, 1.0)    # #F7D7A8
LEG_COL = (0xF2 / 255, 0x5E / 255, 0x34 / 255, 1.0)     # a shade deeper than the body
EYE_COL = (0x1A / 255, 0x14 / 255, 0x12 / 255, 1.0)
HIGHLIGHT = (1.0, 1.0, 1.0, 1.0)

FPS = 24
IDLE_FRAMES = 60          # 2.50 s
WALK_FRAMES = 15          # 0.625 s
HIDE_FRAMES = 10          # 0.417 s
PEEK_FRAMES = 15          # 0.625 s


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials,
                  bpy.data.actions, bpy.data.curves, bpy.data.cameras,
                  bpy.data.lights, bpy.data.images):
        for item in list(block):
            block.remove(item)
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = max(IDLE_FRAMES, WALK_FRAMES, HIDE_FRAMES, PEEK_FRAMES)
    scene.render.fps = FPS
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def r(deg):
    return math.radians(deg)


def make_mat(name, color, roughness=0.85, metallic=0.0, emission=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    color = tuple(color[:3]) + (1.0,)
    mat.diffuse_color = color
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Emission Color" in bsdf.inputs:
        bsdf.inputs["Emission Color"].default_value = color if emission else (0, 0, 0, 1)
    if "Emission Strength" in bsdf.inputs:
        bsdf.inputs["Emission Strength"].default_value = emission
    if "Alpha" in bsdf.inputs:
        bsdf.inputs["Alpha"].default_value = 1.0
    if "Transmission Weight" in bsdf.inputs:
        bsdf.inputs["Transmission Weight"].default_value = 0.0
    if "Transmission" in bsdf.inputs:
        bsdf.inputs["Transmission"].default_value = 0.0
    mat.blend_method = "OPAQUE"
    if hasattr(mat, "shadow_method"):
        try:
            mat.shadow_method = "OPAQUE"
        except Exception:
            pass
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


def solid_image(name, color, size=8):
    img = bpy.data.images.new(name, size, size)
    px = list(color[:3]) + [1.0]
    img.pixels = px * (size * size)
    img.pack()
    return img


def attach_image(mat, image):
    """Hook an image to Base Color and mark it active so Workbench TEXTURE mode shows it."""
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Linear"
    tex.extension = "EXTEND"
    tex.location = (-320, 0)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.nodes.active = tex
    return mat


def make_band_image(path, name="hermit_shell", w=1024, h=256):
    """Soft terracotta spiral stripes on cream, anti-aliased along U."""
    import numpy as np
    arr = np.zeros((h, w, 4), dtype=np.float32)
    cream = SHELL_COL
    band = BAND_COL
    n_bands = 7
    xs = (np.arange(w) + 0.5) / w
    phase = (xs * n_bands) % 1.0
    d = np.abs(phase - 0.5) * 2.0
    t = np.zeros(w, dtype=np.float32)
    solid = d < 0.16
    fade = (d >= 0.16) & (d < 0.50)
    t[solid] = 1.0
    t[fade] = 0.5 + 0.5 * np.cos((d[fade] - 0.16) / 0.34 * math.pi)
    col = np.empty((w, 4), dtype=np.float32)
    for i in range(3):
        col[:, i] = cream[i] * (1.0 - t) + band[i] * t
    col[:, 3] = 1.0
    arr[:, :, :] = col[None, :, :]
    flat = arr.reshape(-1)
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(flat)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    img.pack()
    print("shell texture:", path, path.stat().st_size if path.exists() else 0)
    return img


def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)


def shade_smooth(obj):
    mesh = obj.data
    if hasattr(mesh, "use_auto_smooth"):
        mesh.use_auto_smooth = False
    if hasattr(mesh, "shade_smooth"):
        mesh.shade_smooth()
    if mesh.polygons:
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    sharp = mesh.attributes.get("sharp_edge") if hasattr(mesh, "attributes") else None
    if sharp is not None:
        mesh.attributes.remove(sharp)
    mesh.update()


def apply_subsurf(obj, levels=1):
    """One level of Catmull-Clark, then smooth-shade with no sharp splits."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new("Subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    if hasattr(mod, "uv_smooth"):
        try:
            mod.uv_smooth = "SMOOTH_ALL"
        except Exception:
            pass
    if hasattr(mod, "boundary_smooth"):
        try:
            mod.boundary_smooth = "ALL"
        except Exception:
            pass
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)
    shade_smooth(obj)


def add_uv_sphere(name, radius, segments, rings, loc, scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=radius, segments=segments, ring_count=rings, location=(0.0, 0.0, 0.0)
    )
    obj = bpy.context.active_object
    obj.name = name
    if scale:
        obj.scale = scale
    obj.location = loc
    apply_all(obj)
    shade_smooth(obj)
    return obj


def add_oriented_ellipsoid(name, center, direction, radii, segments=10, rings=8):
    """radii = (rx, ry, rz) with rz along `direction`."""
    bpy.ops.mesh.primitive_uv_sphere_add(
        radius=1.0, segments=segments, ring_count=rings, location=(0.0, 0.0, 0.0)
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (radii[0], radii[1], radii[2])
    n = Vector(direction)
    if n.length < 1e-9:
        n = Vector((0.0, 0.0, 1.0))
    n.normalize()
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0.0, 0.0, 1.0)).rotation_difference(n)
    obj.location = Vector(center)
    apply_all(obj)
    shade_smooth(obj)
    return obj


def add_loft_tube(name, points, radii, segs=8, cap_start=True, cap_end=True):
    """Smooth tapered tube through `points` with per-point radii."""
    pts = [Vector(p) for p in points]
    if len(pts) < 2:
        raise ValueError("need at least two points")
    if len(radii) != len(pts):
        raise ValueError("radii must match points")
    tangents = []
    for i, p in enumerate(pts):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        if t.length < 1e-9:
            t = Vector((0.0, 0.0, 1.0))
        tangents.append(t.normalized())
    ref = Vector((0.0, 0.0, 1.0))
    if abs(tangents[0].dot(ref)) > 0.85:
        ref = Vector((1.0, 0.0, 0.0))
    nor = tangents[0].cross(ref)
    if nor.length < 1e-9:
        nor = Vector((0.0, 1.0, 0.0))
    nor.normalize()
    binor = tangents[0].cross(nor).normalized()
    frames = [(nor, binor)]
    for i in range(1, len(pts)):
        prev_n, prev_b = frames[-1]
        axis = tangents[i - 1].cross(tangents[i])
        if axis.length < 1e-8:
            nor_i, bin_i = prev_n, prev_b
        else:
            ang = tangents[i - 1].angle(tangents[i])
            rot = Matrix.Rotation(ang, 3, axis.normalized())
            nor_i = (rot @ prev_n).normalized()
            bin_i = (rot @ prev_b).normalized()
        frames.append((nor_i, bin_i))

    bm = bmesh.new()
    rings = []
    for p, rad, tan, (nor_i, bin_i) in zip(pts, radii, tangents, frames):
        ring = []
        for k in range(segs):
            a = (k / segs) * 2.0 * math.pi
            offset = (nor_i * math.cos(a) + bin_i * math.sin(a)) * rad
            ring.append(bm.verts.new(p + offset))
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    for i in range(len(rings) - 1):
        for k in range(segs):
            a = rings[i][k]
            b = rings[i][(k + 1) % segs]
            c = rings[i + 1][(k + 1) % segs]
            d = rings[i + 1][k]
            bm.faces.new((a, b, c, d))
    if cap_start:
        bm.faces.new(list(reversed(rings[0])))
    if cap_end:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    shade_smooth(obj)
    return obj


def assign_group(obj, group_name, weight=1.0):
    vg = obj.vertex_groups.new(name=group_name)
    n = len(obj.data.vertices)
    if n:
        vg.add(list(range(n)), weight, "REPLACE")


def assign_chain_weights(obj, joints, bone_names, parent_bone=None):
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
    bpy.ops.object.shade_smooth()
    return obj


def triangle_count(obj):
    mesh = obj.data
    mesh.calc_loop_triangles()
    return len(mesh.loop_triangles)


def add_spiral_shell(name, mats, img):
    """Chubby spiral gastropod, built as a Bezier curve with a round bevel
    so the whorls and opening stay smooth. A slim rolled lip is part of the
    shell; the aperture hugs the crab instead of flaring into a collar.
    """
    n_whorls = 3.3
    theta_max = n_whorls * 2.0 * math.pi
    n_pts = 16
    r_ap, t_ap = 1.68 * CM, 0.82 * CM
    r_ax, t_ax = 0.26 * CM, 0.22 * CM
    k_exp = math.log(r_ap / r_ax) / theta_max
    axis_len = 2.50 * CM
    lip_r = 0.16 * CM
    lip_angles = (0.70, 1.40, 2.10)
    bevel_res = 8  # 20-sided cross-section

    axis = Vector((0.10, 0.48, 0.87)).normalized()
    open_fwd = Vector((0.0, -0.90, -0.44)).normalized()
    radial_end = open_fwd.cross(axis)
    if radial_end.length < 1e-6:
        radial_end = Vector((1.0, 0.0, 0.0))
    radial_end.normalize()

    opening = Vector((0.10, -1.55, 2.20)) * CM

    def radius(theta):
        return r_ax * math.exp(k_exp * theta)

    def tube_r(theta):
        return t_ax * math.exp(k_exp * theta)

    def centre_and_rad(theta):
        rot = Matrix.Rotation(theta - theta_max, 3, axis)
        rad = (rot @ radial_end).normalized()
        dist = (1.0 - theta / theta_max) * axis_len
        centre = opening + axis * dist + rad * radius(theta) - radial_end * radius(theta_max)
        return centre, rad

    centres = []
    radials = []
    tube_rs = []
    thetas = []
    for i in range(n_pts):
        tt = i / (n_pts - 1)
        theta = tt * theta_max
        centre, rad = centre_and_rad(theta)
        centres.append(centre)
        radials.append(rad)
        tube_rs.append(tube_r(theta))
        thetas.append(theta)

    c_end = centres[-1]
    tangent = centres[-1] - centres[-2]
    if tangent.length < 1e-9:
        tangent = open_fwd
    tangent.normalize()
    rad_end = radials[-1]
    tr_end = tube_rs[-1]

    curve_data = bpy.data.curves.new(name + "_path", "CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 3
    curve_data.fill_mode = "FULL"
    curve_data.twist_mode = "MINIMUM"
    curve_data.use_fill_caps = False
    curve_data.bevel_mode = "ROUND"
    curve_data.bevel_depth = 1.0
    curve_data.bevel_resolution = bevel_res

    spline = curve_data.splines.new("BEZIER")
    spline.bezier_points.add(n_pts - 1)
    spline.resolution_u = 3
    for i, bp in enumerate(spline.bezier_points):
        bp.co = centres[i]
        bp.radius = tube_rs[i]
        bp.tilt = 0.0
        bp.handle_left_type = "FREE"
        bp.handle_right_type = "FREE"
        prev = centres[max(0, i - 1)]
        nxt = centres[min(n_pts - 1, i + 1)]
        h = (nxt - prev) / 6.0
        bp.handle_left = bp.co - h
        bp.handle_right = bp.co + h
    spline.bezier_points[0].handle_left = centres[0]
    spline.bezier_points[-1].handle_right = centres[-1]

    obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.convert(target="MESH")
    mesh = obj.data
    mesh.name = name
    obj.name = name

    n_sides = 4 + 2 * bevel_res
    if len(mesh.vertices) % n_sides != 0:
        raise RuntimeError(f"curve mesh verts {len(mesh.vertices)} not multiple of {n_sides}")
    n_rings = len(mesh.vertices) // n_sides
    keep_until = int(n_rings * 0.55)
    keep = [0] + [r for r in range(1, keep_until) if r % 3 == 0] + list(range(keep_until, n_rings))
    # Rebuild a clean tube from the kept rings so the fat last whorls stay
    # 20-sided and finely sampled, while the tight tip is cheaper.
    coords = [[mesh.vertices[r * n_sides + k].co.copy() for k in range(n_sides)] for r in keep]
    bm_r = bmesh.new()
    rings_v = []
    for row in coords:
        rings_v.append([bm_r.verts.new(co) for co in row])
    bm_r.verts.ensure_lookup_table()
    for i in range(len(rings_v) - 1):
        for k in range(n_sides):
            bm_r.faces.new((
                rings_v[i][k],
                rings_v[i][(k + 1) % n_sides],
                rings_v[i + 1][(k + 1) % n_sides],
                rings_v[i + 1][k],
            ))
    bm_r.to_mesh(mesh)
    bm_r.free()
    mesh.update()
    print(f"  rebuilt tube: {n_rings} -> {len(keep)} rings, {len(mesh.vertices)} verts")

    n_rings = len(keep)
    n_tube_verts = len(mesh.vertices)
    ring_centres = []
    for ring in range(n_rings):
        acc = Vector((0.0, 0.0, 0.0))
        for k in range(n_sides):
            acc += mesh.vertices[ring * n_sides + k].co
        ring_centres.append(acc / n_sides)
    arc = [0.0]
    for i in range(1, n_rings):
        arc.append(arc[-1] + (ring_centres[i] - ring_centres[i - 1]).length)
    total = arc[-1] if arc[-1] > 1e-12 else 1.0
    vert_uv = {}
    for ring in range(n_rings):
        u = arc[ring] / total
        for k in range(n_sides):
            vert_uv[ring * n_sides + k] = (u, k / n_sides)

    if mesh.uv_layers.active is None:
        mesh.uv_layers.new(name="UVMap")
    loops = mesh.uv_layers.active.data
    for poly in mesh.polygons:
        uvs = [vert_uv[li] for li in poly.vertices]
        vs = [u[1] for u in uvs]
        if max(vs) - min(vs) > 0.5:
            uvs = [(u, v + 1.0) if v < 0.5 else (u, v) for u, v in uvs]
        for loop_i, uv in zip(poly.loop_indices, uvs):
            loops[loop_i].uv = uv

    def boundary_loops(bm_obj):
        bm_obj.edges.ensure_lookup_table()
        used = set()
        loops = []
        for e in bm_obj.edges:
            if not e.is_boundary or e.index in used:
                continue
            loop_edges = []
            cur = e
            while cur is not None and cur.index not in used:
                used.add(cur.index)
                loop_edges.append(cur)
                nxt = None
                for v in cur.verts:
                    for e2 in v.link_edges:
                        if e2.is_boundary and e2.index not in used:
                            nxt = e2
                            break
                    if nxt is not None:
                        break
                cur = nxt
            verts = []
            seen = set()
            for ed in loop_edges:
                for v in ed.verts:
                    if v.index not in seen:
                        seen.add(v.index)
                        verts.append(v)
            if verts:
                mid = sum((v.co for v in verts), Vector()) / len(verts)
                rad = sum((v.co - mid).length for v in verts) / len(verts)
                loops.append((verts, mid, rad))
        return loops

    # Switch to bmesh to add a slim rolled lip, apex cap and dark interior.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    loops = boundary_loops(bm)
    if len(loops) < 2:
        n_list = [len(L[0]) for L in loops]
        bm.free()
        raise RuntimeError(f"shell expected 2 open rings, got {len(loops)} sizes={n_list}")
    # Larger ring is the aperture; the smaller is the apex.
    loops = sorted(loops, key=lambda L: L[2])
    start_vs = loops[0][0]
    end_vs, end_mid, end_rad = loops[-1]
    # Walk the end ring in connected order, starting from an arbitrary vert.
    n_phi = len(end_vs)
    if n_phi < 6:
        bm.free()
        raise RuntimeError(f"shell opening ring too small: {n_phi}")
    # Re-order end verts around the tangent so later bridges stay untwisted.
    def end_angle(v):
        rel = v.co - c_end
        rel = rel - tangent * rel.dot(tangent)
        nor = rad_end.normalized()
        binor = tangent.cross(nor).normalized()
        nor = binor.cross(tangent).normalized()
        return math.atan2(rel.dot(binor), rel.dot(nor))
    end_vs = sorted(end_vs, key=end_angle)

    def ring_dirs():
        dirs = []
        for v in end_vs:
            d = v.co - c_end
            # Project off the tangent so we get a clean radial in the aperture plane.
            d = d - tangent * d.dot(tangent)
            if d.length < 1e-9:
                d = rad_end
            dirs.append(d.normalized())
        return dirs

    dirs = ring_dirs()
    # Mean tube radius at the mouth, for a tight lip.
    tr_mean = sum((v.co - c_end - tangent * (v.co - c_end).dot(tangent)).length for v in end_vs) / n_phi

    lip_rings = []
    for a in lip_angles:
        ring = []
        for d in dirs:
            pos = (
                c_end
                + d * (tr_mean + lip_r * (1.0 - math.cos(a)))
                + tangent * (lip_r * math.sin(a))
            )
            ring.append(bm.verts.new(pos))
        lip_rings.append(ring)
    bm.verts.ensure_lookup_table()

    def bridge_rings(r0, r1, flip=False):
        faces = []
        for k in range(n_phi):
            a = r0[k]
            b = r0[(k + 1) % n_phi]
            c = r1[(k + 1) % n_phi]
            d = r1[k]
            f = bm.faces.new((a, d, c, b) if flip else (a, b, c, d))
            faces.append(f)
        return faces

    lip_faces_all = []
    lip_faces_all.extend(bridge_rings(end_vs, lip_rings[0]))
    for i in range(len(lip_rings) - 1):
        lip_faces_all.extend(bridge_rings(lip_rings[i], lip_rings[i + 1]))
    last_lip_faces = lip_faces_all[-n_phi:]
    earlier_lip_faces = lip_faces_all[:-n_phi]

    # Solid apex at the small end.
    apex_c, _ = centre_and_rad(0.0)
    cap = bm.verts.new(apex_c + axis * (0.18 * CM))
    def start_angle(v):
        rel = v.co - apex_c
        return math.atan2(rel.dot(radials[0].cross(axis)), rel.dot(radials[0]))
    start_vs = sorted(start_vs, key=start_angle)
    apex_faces = []
    try:
        for k in range(len(start_vs)):
            apex_faces.append(bm.faces.new((cap, start_vs[k], start_vs[(k + 1) % len(start_vs)])))
    except Exception:
        apex_faces = []

    # Dark interior starts immediately inside the mouth, almost the same radius,
    # so the opening reads as a slim lip around a dark hole — not a cream collar.
    inner = []
    last = lip_rings[-1]
    for depth, scale in ((0.10 * CM, 0.92), (0.42 * CM, 0.62), (0.85 * CM, 0.28)):
        centre = c_end - tangent * depth
        ring = []
        for d in dirs:
            ring.append(bm.verts.new(centre + d * (tr_mean * scale)))
        inner.append(ring)
    interior_faces = []
    interior_faces.extend(bridge_rings(last, inner[0], flip=True))
    for i in range(len(inner) - 1):
        interior_faces.extend(bridge_rings(inner[i], inner[i + 1]))
    mid = sum((v.co for v in inner[-1]), Vector()) / n_phi
    pit = bm.verts.new(mid - tangent * (0.16 * CM))
    for k in range(n_phi):
        interior_faces.append(bm.faces.new((pit, inner[-1][k], inner[-1][(k + 1) % n_phi])))

    obj.data.materials.clear()
    obj.data.materials.append(mats["shell"])
    obj.data.materials.append(mats["interior"])
    obj.data.materials.append(mats["rim"])
    for f in bm.faces:
        f.material_index = 0
    for f in earlier_lip_faces:
        f.material_index = 0
    for f in last_lip_faces:
        f.material_index = 2
    for f in interior_faces:
        f.material_index = 1
    for f in apex_faces:
        f.material_index = 0

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    # Rebuild UVs: tube verts keep ring UVs; lip continues past U=1; interior parks.
    if mesh.uv_layers.active is None:
        mesh.uv_layers.new(name="UVMap")
    loops = mesh.uv_layers.active.data
    # Recompute lip/new vert UVs by angle around the aperture.
    def lip_uv(co):
        rel = co - c_end
        rel = rel - tangent * rel.dot(tangent)
        nor = rad_end.normalized()
        binor = tangent.cross(nor)
        if binor.length < 1e-8:
            binor = tangent.cross(axis)
        binor.normalize()
        nor = binor.cross(tangent).normalized()
        ang = math.atan2(rel.dot(binor), rel.dot(nor))
        vv = (ang / (2.0 * math.pi)) % 1.0
        ahead = (co - c_end).dot(tangent)
        u = 1.0 + min(0.04, max(0.0, ahead) / max(lip_r, 1e-6) * 0.02)
        return (u, vv)

    for vi in range(n_tube_verts, len(mesh.vertices)):
        vert_uv[vi] = lip_uv(mesh.vertices[vi].co)
    for poly in mesh.polygons:
        if poly.material_index == 1:
            for loop_i in poly.loop_indices:
                loops[loop_i].uv = (0.04, 0.5)
            continue
        uvs = []
        for li in poly.vertices:
            if li in vert_uv:
                uvs.append(vert_uv[li])
            else:
                uvs.append(lip_uv(mesh.vertices[li].co))
        vs = [u[1] for u in uvs]
        if max(vs) - min(vs) > 0.5:
            uvs = [(u, v + 1.0) if v < 0.5 else (u, v) for u, v in uvs]
        for loop_i, uv in zip(poly.loop_indices, uvs):
            loops[loop_i].uv = uv

    shade_smooth(obj)
    print(f"  curve-shell: {sum(len(p.vertices)-2 for p in mesh.polygons)} tris, opening sides={n_phi}")
    return obj, opening, tangent, axis



def build_meshes(mats, shell_img):
    """Return (parts, bones). Face toward Blender -Y. Feet on Z=0."""
    parts = []
    bones = []

    shell, aperture, open_dir, axis = add_spiral_shell("shell", mats, shell_img)
    assign_group(shell, "shell")
    parts.append(shell)

    # Crab body plugging the mouth, a plump coral chest peeking out.
    body_c = aperture + open_dir * (0.18 * CM) + Vector((0.0, 0.0, 0.04 * CM))
    body_s = Vector((0.95, 1.05, 0.80)) * CM
    body = add_oriented_ellipsoid(
        "body", body_c, open_dir, (body_s.x, body_s.z, body_s.y), segments=12, rings=8
    )
    set_material(body, mats["body"])
    assign_group(body, "body")
    parts.append(body)

    # Eyestalks, glossy eyes, highlights.
    eye_r = 0.28 * CM
    for side, tag in ((1, "L"), (-1, "R")):
        s = float(side)
        base = body_c + Vector((s * 0.32, -0.22, 0.32)) * CM
        tip = body_c + Vector((s * 0.40, -0.48, 0.78)) * CM
        stalk = add_loft_tube(
            f"stalk_{tag}",
            [base, base.lerp(tip, 0.55), tip],
            [0.11 * CM, 0.10 * CM, 0.09 * CM],
            segs=8,
            cap_start=True,
            cap_end=True,
        )
        set_material(stalk, mats["body"])
        assign_group(stalk, f"eye_{tag}")
        parts.append(stalk)
        look = (open_dir + Vector((s * 0.15, 0.0, 0.12))).normalized()
        eye = add_uv_sphere(f"eye_{tag}", eye_r, 8, 6, tip + look * (eye_r * 0.15))
        set_material(eye, mats["eye"])
        assign_group(eye, f"eye_{tag}")
        parts.append(eye)
        hl_dir = (look + Vector((0.0, 0.0, 0.75))).normalized()
        hl = add_uv_sphere(f"hl_{tag}", 0.10 * CM, 6, 4, tip + look * (eye_r * 0.15) + hl_dir * (eye_r * 0.72))
        set_material(hl, mats["highlight"])
        assign_group(hl, f"eye_{tag}")
        parts.append(hl)
        bones.append((f"eye_{tag}", "body", base, tip))

    # Tiny bent antennae.
    for side, tag in ((1, "L"), (-1, "R")):
        s = float(side)
        a0 = body_c + Vector((s * 0.10, -0.50, 0.18)) * CM
        a1 = a0 + Vector((s * 0.16, -0.40, 0.32)) * CM
        a2 = a1 + Vector((s * 0.10, -0.28, -0.20)) * CM
        ant = add_loft_tube(
            f"ant_{tag}", [a0, a1, a2],
            [0.055 * CM, 0.045 * CM, 0.03 * CM],
            segs=6, cap_start=True, cap_end=True,
        )
        set_material(ant, mats["body"])
        assign_group(ant, f"ant_{tag}")
        parts.append(ant)
        bones.append((f"ant_{tag}", "body", a0, a2))

    # Claws: larger left crusher, smaller right. Peach-cream tips.
    def add_claw(tag, side, big):
        s = float(side)
        scale = 1.0 if big else 0.72
        hip = body_c + Vector((s * 0.62, 0.02, -0.22)) * CM
        mid = hip + Vector((s * 0.65, -0.50, -0.22)) * CM * scale
        palm = mid + Vector((s * 0.50, -0.62, -0.12)) * CM * scale
        # Arm
        arm = add_loft_tube(
            f"clawarm_{tag}",
            [hip, hip.lerp(mid, 0.5), mid],
            [0.22 * CM * scale, 0.20 * CM * scale, 0.24 * CM * scale],
            segs=8, cap_start=True, cap_end=True,
        )
        set_material(arm, mats["body"])
        assign_chain_weights(arm, [hip, mid, palm], [f"claw_{tag}", f"claw_{tag}2"], parent_bone="body")
        parts.append(arm)
        # Puffy palm
        palm_obj = add_oriented_ellipsoid(
            f"palm_{tag}",
            palm,
            (palm - mid),
            (0.48 * CM * scale, 0.38 * CM * scale, 0.52 * CM * scale),
            segments=8, rings=6,
        )
        set_material(palm_obj, mats["body"])
        assign_group(palm_obj, f"claw_{tag}2")
        parts.append(palm_obj)
        # Two soft pincer lobes with cream tips.
        fwd = (palm - mid).normalized()
        up = Vector((0.0, 0.0, 1.0))
        side_v = fwd.cross(up)
        if side_v.length < 1e-9:
            side_v = Vector((s, 0.0, 0.0))
        side_v.normalize()
        up = side_v.cross(fwd).normalized()
        for k, lobe_side in enumerate((1, -1)):
            lobe_c = palm + fwd * (0.42 * CM * scale) + up * (lobe_side * 0.22 * CM * scale)
            lobe = add_oriented_ellipsoid(
                f"pincer_{tag}_{k}",
                lobe_c,
                fwd + up * (lobe_side * 0.25),
                (0.22 * CM * scale, 0.16 * CM * scale, 0.38 * CM * scale),
                segments=7, rings=5,
            )
            set_material(lobe, mats["body"])
            assign_group(lobe, f"claw_{tag}2")
            parts.append(lobe)
            tip_c = lobe_c + fwd * (0.28 * CM * scale) + up * (lobe_side * 0.08 * CM * scale)
            tip = add_oriented_ellipsoid(
                f"tip_{tag}_{k}",
                tip_c,
                fwd,
                (0.16 * CM * scale, 0.12 * CM * scale, 0.20 * CM * scale),
                segments=6, rings=4,
            )
            set_material(tip, mats["clawTip"])
            assign_group(tip, f"claw_{tag}2")
            parts.append(tip)
        bones.append((f"claw_{tag}", "body", hip, mid))
        bones.append((f"claw_{tag}2", f"claw_{tag}", mid, palm + fwd * (0.3 * CM * scale)))
        return hip, mid, palm

    add_claw("L", 1, True)
    add_claw("R", -1, False)

    # Four walking legs, planted on Z=0. Chunkier, gently bowed, tapering
    # to rounded points — no disc pads. Angled outward for a sturdy stance.
    bc = body_c
    leg_plan = {
        "fl": {"hip": bc + Vector(( 0.62, -0.36, -0.16)) * CM, "knee": bc + Vector(( 1.55, -0.90, -0.58)) * CM, "foot": bc + Vector(( 1.90, -1.28, -1.40)) * CM},
        "fr": {"hip": bc + Vector((-0.62, -0.36, -0.16)) * CM, "knee": bc + Vector((-1.55, -0.90, -0.58)) * CM, "foot": bc + Vector((-1.90, -1.28, -1.40)) * CM},
        "bl": {"hip": bc + Vector(( 0.70,  0.36, -0.16)) * CM, "knee": bc + Vector(( 1.68,  0.62, -0.58)) * CM, "foot": bc + Vector(( 2.05,  0.82, -1.40)) * CM},
        "br": {"hip": bc + Vector((-0.70,  0.36, -0.16)) * CM, "knee": bc + Vector((-1.68,  0.62, -0.58)) * CM, "foot": bc + Vector((-2.05,  0.82, -1.40)) * CM},
    }
    for tag, pts in leg_plan.items():
        hip = Vector(pts["hip"])
        knee = Vector(pts["knee"])
        foot = Vector(pts["foot"])
        foot = Vector((foot.x, foot.y, 0.11 * CM))
        out = Vector((1.0 if hip.x >= 0 else -1.0, 0.0, 0.0))
        p1 = hip.lerp(knee, 0.38) + out * (0.18 * CM)
        p2 = knee + out * (0.14 * CM)
        p3 = knee.lerp(foot, 0.55) + out * (0.08 * CM)
        d = foot - p3
        if d.length < 1e-9:
            d = Vector((0.0, 0.0, -1.0))
        tip = foot + d.normalized() * (0.09 * CM)
        tube = add_loft_tube(
            f"leg_{tag}",
            [hip, p1, p2, p3, foot, tip],
            [0.24 * CM, 0.22 * CM, 0.19 * CM, 0.15 * CM, 0.12 * CM, 0.035 * CM],
            segs=8, cap_start=True, cap_end=True,
        )
        set_material(tube, mats["leg"])
        assign_chain_weights(tube, [hip, knee, foot], [f"leg_{tag}", f"leg_{tag}2"], parent_bone="body")
        parts.append(tube)
        bones.append((f"leg_{tag}", "body", hip, knee))
        bones.append((f"leg_{tag}2", f"leg_{tag}", knee, foot))

    # Root, shell and body bones.
    shell_c = aperture + axis * (1.4 * CM)
    shell_tail = shell_c + axis * (1.2 * CM)
    bones.insert(0, ("root", None, Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.45 * CM))))
    bones.insert(1, ("shell", "root", aperture, shell_tail))
    bones.insert(2, ("body", "root", body_c, body_c + open_dir * (0.7 * CM)))

    return parts, bones, aperture, open_dir, body_c


def build_armature(bones):
    data = bpy.data.armatures.new("HermitArmature")
    data.display_type = "OCTAHEDRAL"
    arm = bpy.data.objects.new("HermitArmature", data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    edit = {}
    for name, parent, head, tail in bones:
        eb = data.edit_bones.new(name)
        eb.head = Vector(head)
        eb.tail = Vector(tail)
        if (eb.tail - eb.head).length < 0.004 * CM:
            direction = Vector(tail) - Vector(head)
            if direction.length < 1e-9:
                direction = Vector((0.0, 0.0, 1.0))
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


def _set_interp(pb, data_path, frame, interpolation):
    if not (pb.id_data.animation_data and pb.id_data.animation_data.action):
        return
    action = pb.id_data.animation_data.action
    for fc in action.fcurves:
        if fc.data_path == f'pose.bones["{pb.name}"].{data_path}':
            for kp in fc.keyframe_points:
                if int(kp.co.x) == frame:
                    kp.interpolation = interpolation
                    kp.handle_left_type = "AUTO"
                    kp.handle_right_type = "AUTO"


def key_euler(pb, frame, euler, interpolation="BEZIER"):
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = euler
    pb.keyframe_insert(data_path="rotation_euler", frame=frame)
    _set_interp(pb, "rotation_euler", frame, interpolation)


def key_loc(pb, frame, loc, interpolation="BEZIER"):
    pb.location = Vector(loc)
    pb.keyframe_insert(data_path="location", frame=frame)
    _set_interp(pb, "location", frame, interpolation)


def key_scale(pb, frame, scale, interpolation="BEZIER"):
    pb.scale = Vector(scale)
    pb.keyframe_insert(data_path="scale", frame=frame)
    _set_interp(pb, "scale", frame, interpolation)


def key_rest(arm, frame):
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


def animate_idle(arm):
    action = ensure_action(arm, "idle", IDLE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    key_rest(arm, 0)
    pb = arm.pose.bones
    for fr, ant, eye, shell_z, claw in (
        (15, r(10), r(6), r(2.5), r(-4)),
        (30, r(-8), r(-4), r(-1.5), r(5)),
        (45, r(7), r(5), r(2.0), r(-3)),
        (IDLE_FRAMES, 0.0, 0.0, 0.0, 0.0),
    ):
        key_euler(pb["ant_L"], fr, (ant, 0, r(4) if fr not in (0, IDLE_FRAMES) else 0))
        key_euler(pb["ant_R"], fr, (ant * 0.85, 0, r(-3) if fr not in (0, IDLE_FRAMES) else 0))
        key_euler(pb["eye_L"], fr, (eye, 0, r(3) if fr != IDLE_FRAMES else 0))
        key_euler(pb["eye_R"], fr, (eye * 0.8, 0, r(-2) if fr != IDLE_FRAMES else 0))
        key_euler(pb["shell"], fr, (shell_z, r(1.2) * (1 if fr == 15 else -1 if fr == 45 else 0), 0))
        key_euler(pb["claw_L"], fr, (0, 0, claw))
        key_euler(pb["claw_R"], fr, (0, 0, -claw * 0.6))
        key_loc(pb["shell"], fr, (0, 0, 0.03 * CM * math.sin(fr / IDLE_FRAMES * 2 * math.pi)))
    # Make sure frame 0 matches the end for a clean loop (key_rest already did 0).
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "idle")
    return action


def animate_walk(arm):
    """In-place forward crawl along local -Y (export +Z). No root motion."""
    action = ensure_action(arm, "walk", WALK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    key_rest(arm, 0)
    pb = arm.pose.bones
    group_a = ("leg_fl", "leg_br")
    group_b = ("leg_fr", "leg_bl")
    mid = WALK_FRAMES // 2
    # Swing in X (side is already splayed) and Y (forward/back in Blender).
    # Upper bone: rotate around X to step forward/back; lower folds on the swing.
    def gait(names, phase_fwd):
        # phase_fwd True: forward at mid frame, planted at 0 / end
        for name in names:
            lower = name + "2"
            if phase_fwd:
                keys = (
                    (0, r(0), r(0)),
                    (mid, r(18), r(-22)),
                    (WALK_FRAMES, r(0), r(0)),
                )
            else:
                keys = (
                    (0, r(0), r(0)),
                    (mid, r(-16), r(8)),
                    (WALK_FRAMES, r(0), r(0)),
                )
            for fr, up, lo in keys:
                # Bones are along the leg, roughly outward and down. Rotate around
                # a world-ish X (forward/back) and a little Z (lift).
                key_euler(pb[name], fr, (up, 0, r(6) if (phase_fwd and fr == mid) or (not phase_fwd and fr == 0) else 0))
                key_euler(pb[lower], fr, (lo, 0, 0))
    gait(group_a, True)
    gait(group_b, False)
    # Opposite mid: group_b swings at 0 already rest; add a swing at 0 by
    # starting group_b planted and swinging at frame 0? For a loop, group_b
    # should be mid-swing at frame 0. Re-key group_b so frame 0 = mid-swing.
    # Simpler even cycle: key group_b at 0 as the "other" mid, and mid as rest.
    for name in group_b:
        key_euler(pb[name], 0, (r(18), 0, r(6)))
        key_euler(pb[name + "2"], 0, (r(-22), 0, 0))
        key_euler(pb[name], mid, (0, 0, 0))
        key_euler(pb[name + "2"], mid, (0, 0, 0))
        key_euler(pb[name], WALK_FRAMES, (r(18), 0, r(6)))
        key_euler(pb[name + "2"], WALK_FRAMES, (r(-22), 0, 0))
    for fr, bob, pitch in (
        (0, 0.0, 0.0),
        (mid // 2, 0.06 * CM, r(3)),
        (mid, 0.0, 0.0),
        (mid + mid // 2, 0.06 * CM, r(3)),
        (WALK_FRAMES, 0.0, 0.0),
    ):
        key_loc(pb["shell"], fr, (0.0, 0.0, bob))
        key_euler(pb["shell"], fr, (pitch, 0, 0))
        key_loc(pb["body"], fr, (0.0, -0.04 * CM * (1 if bob else 0), bob * 0.4))
        key_euler(pb["claw_L"], fr, (r(-6) if bob else 0, 0, 0))
        key_euler(pb["claw_R"], fr, (r(-4) if bob else 0, 0, 0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "walk")
    return action


def world_to_pose_loc(pb, world_vec):
    """Pose-space location that yields the given world-space translation."""
    w = Vector(world_vec)
    return Vector((w.dot(pb.x_axis), w.dot(pb.y_axis), w.dot(pb.z_axis)))


def _tuck_pose(pb):
    """Fully withdrawn: body back into the shell, limbs folded, shell lowered."""
    # Body bone Y points out of the aperture; retract along -Y in world terms of that axis.
    into = -pb["body"].y_axis.normalized()
    body_loc = world_to_pose_loc(pb["body"], into * (3.70 * CM))
    down = Vector((0.0, 0.0, -1.0))
    shell_loc = world_to_pose_loc(pb["shell"], down * (0.20 * CM) + into * (0.06 * CM))
    return {
        "body_loc": body_loc,
        "body_rot": (r(8), 0, 0),
        "shell_loc": shell_loc,
        "shell_rot": (r(4), r(-2), 0),
        "eye_L": (r(35), r(8), r(20)),
        "eye_R": (r(35), r(-8), r(-20)),
        "ant_L": (r(50), 0, r(25)),
        "ant_R": (r(50), 0, r(-25)),
        "claw_L": (r(40), r(-8), r(22)),
        "claw_L2": (r(35), 0, r(18)),
        "claw_R": (r(40), r(8), r(-22)),
        "claw_R2": (r(35), 0, r(-18)),
        "leg_fl": (r(50), r(8), r(18)),
        "leg_fl2": (r(55), 0, 0),
        "leg_fr": (r(50), r(-8), r(-18)),
        "leg_fr2": (r(55), 0, 0),
        "leg_bl": (r(30), r(10), r(20)),
        "leg_bl2": (r(50), 0, 0),
        "leg_br": (r(30), r(-10), r(-20)),
        "leg_br2": (r(50), 0, 0),
    }


def _apply_tuck(pb, pose, frame, limb_scale=1.0):
    key_loc(pb["body"], frame, pose["body_loc"])
    key_euler(pb["body"], frame, pose["body_rot"])
    key_loc(pb["shell"], frame, pose["shell_loc"])
    key_euler(pb["shell"], frame, pose["shell_rot"])
    for name, euler in pose.items():
        if name in ("body_loc", "body_rot", "shell_loc", "shell_rot"):
            continue
        if name in pb:
            key_euler(pb[name], frame, euler)
    if limb_scale != 1.0:
        for name in (
            "claw_L", "claw_L2", "claw_R", "claw_R2",
            "leg_fl", "leg_fl2", "leg_fr", "leg_fr2",
            "leg_bl", "leg_bl2", "leg_br", "leg_br2",
            "ant_L", "ant_R", "eye_L", "eye_R",
        ):
            if name in pb:
                key_scale(pb[name], frame, (limb_scale, limb_scale, limb_scale))


def animate_hide(arm):
    action = ensure_action(arm, "hide", HIDE_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    key_rest(arm, 0)
    pb = arm.pose.bones
    mid = HIDE_FRAMES // 2
    # Halfway: eyes and claws already ducking, legs starting to fold.
    half = _tuck_pose(pb)
    half = dict(half)
    into = -pb["body"].y_axis.normalized()
    half["body_loc"] = world_to_pose_loc(pb["body"], into * (1.15 * CM))
    half["shell_loc"] = world_to_pose_loc(pb["shell"], Vector((0.0, 0.0, -0.10 * CM)))
    _apply_tuck(pb, half, mid, limb_scale=0.72)
    _apply_tuck(pb, _tuck_pose(pb), HIDE_FRAMES, limb_scale=0.26)
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "hide")
    return action


def animate_peek(arm):
    action = ensure_action(arm, "peek", PEEK_FRAMES)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    pb = arm.pose.bones
    # Start tucked, end almost at rest (eyes and claws out first).
    _apply_tuck(pb, _tuck_pose(pb), 0, limb_scale=0.26)
    key_scale(pb["root"], 0, (1, 1, 1))
    # Mid peek: eyes and antennae out, claws halfway, legs still mostly in.
    mid = PEEK_FRAMES // 2
    mid_pose = _tuck_pose(pb)
    mid_pose = dict(mid_pose)
    into = -pb["body"].y_axis.normalized()
    mid_pose["body_loc"] = world_to_pose_loc(pb["body"], into * (0.70 * CM))
    mid_pose["body_rot"] = (r(8), 0, 0)
    mid_pose["shell_loc"] = world_to_pose_loc(pb["shell"], (0.0, 0.03 * CM, -0.10 * CM))
    mid_pose["shell_rot"] = (r(3), 0, 0)
    mid_pose["eye_L"] = (r(-6), 0, r(-4))
    mid_pose["eye_R"] = (r(-6), 0, r(4))
    mid_pose["ant_L"] = (r(-8), 0, 0)
    mid_pose["ant_R"] = (r(-8), 0, 0)
    mid_pose["claw_L"] = (r(8), 0, r(18))
    mid_pose["claw_R"] = (r(8), 0, r(-16))
    _apply_tuck(pb, mid_pose, mid, limb_scale=0.72)
    # End: nearly rest, a touch cautious (claws still a little in).
    key_rest(arm, PEEK_FRAMES)
    key_euler(pb["claw_L"], PEEK_FRAMES, (0, 0, r(8)))
    key_euler(pb["claw_R"], PEEK_FRAMES, (0, 0, r(-6)))
    key_euler(pb["eye_L"], PEEK_FRAMES, (r(-4), 0, 0))
    key_euler(pb["eye_R"], PEEK_FRAMES, (r(-4), 0, 0))
    bpy.ops.object.mode_set(mode="OBJECT")
    push_nla(arm, action, "peek")
    return action


def settle_to_ground(obj, bones=None):
    """Lift or drop the mesh (and bone joints) so the lowest vertex sits on Z=0."""
    zs = [v.co.z for v in obj.data.vertices]
    lo = min(zs)
    if abs(lo) > 1e-6:
        for v in obj.data.vertices:
            v.co.z -= lo
        obj.data.update()
        if bones:
            shifted = []
            for name, parent, head, tail in bones:
                h, tl = Vector(head), Vector(tail)
                h.z -= lo
                tl.z -= lo
                shifted.append((name, parent, h, tl))
            bones[:] = shifted
    print(f"settled ground: z min was {lo:.5f}, now {min(v.co.z for v in obj.data.vertices):.5f}")


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
    vs.exposure = 0.18
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
    shading.color_type = "TEXTURE"
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

    world = bpy.data.worlds.new("HermitPreviewWorld") if "HermitPreviewWorld" not in bpy.data.worlds else bpy.data.worlds["HermitPreviewWorld"]
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

    view_34 = ((11.5, -16.0, 9.5), (0.2, 0.0, 2.4))
    view_side = ((24.0, -2.8, 7.2), (0.15, -0.7, 2.6))
    PREVIEW_REPO.parent.mkdir(parents=True, exist_ok=True)
    _shot(PREVIEW_REPO, *view_34, "idle", 12)
    shutil.copy2(PREVIEW_REPO, PREVIEW_WORKSPACE)
    _shot(PREVIEW_SIDE, *view_side, "idle", 12)
    shutil.copy2(PREVIEW_SIDE, PREVIEW_REPO_SIDE)
    _shot(PREVIEW_WALK, *view_34, "walk", 4)
    shutil.copy2(PREVIEW_WALK, PREVIEW_REPO_WALK)
    _shot(PREVIEW_HIDE, *view_34, "hide", HIDE_FRAMES)
    shutil.copy2(PREVIEW_HIDE, PREVIEW_REPO_HIDE)
    # QA
    _shot(Path("/tmp/hermit-front.png"), (0.2, -16.5, 5.8), (0.0, -0.2, 1.9), "idle", 12)
    _shot(Path("/tmp/hermit-top.png"), (0.2, -0.4, 18.0), (0.1, 0.2, 0.0), "idle", 12)
    _shot(Path("/tmp/hermit-walk-side.png"), *view_side, "walk", 4)
    _shot(Path("/tmp/hermit-peek.png"), *view_34, "peek", 8)
    _shot(Path("/tmp/hermit-hide-side.png"), *view_side, "hide", HIDE_FRAMES)

    if arm.animation_data:
        arm.animation_data.action = None
        arm.animation_data.use_nla = True
    for name in ("PreviewCam", "Key", "Fill"):
        obj = bpy.data.objects.get(name)
        if obj:
            bpy.data.objects.remove(obj, do_unlink=True)


def export_glb():
    GLB_PATH.parent.mkdir(parents=True, exist_ok=True)
    arm = bpy.data.objects.get("HermitArmature")
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
    want = {"idle", "walk", "hide", "peek"}
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
    shell_img = make_band_image(SHELL_TEX, "hermit_shell")
    mats = {
        "shell": set_coat(attach_image(make_mat("shell", SHELL_COL, roughness=0.52), shell_img), 0.16, 0.35),
        "rim": set_coat(attach_image(make_mat("rim", RIM_COL, roughness=0.50), solid_image("rim_tex", RIM_COL)), 0.12, 0.38),
        "interior": attach_image(make_mat("interior", INTERIOR_COL, roughness=0.85), solid_image("interior_tex", INTERIOR_COL)),
        "body": set_coat(attach_image(make_mat("body", BODY_COL, roughness=0.50), solid_image("body_tex", BODY_COL)), 0.14, 0.32),
        "clawTip": set_coat(attach_image(make_mat("clawTip", CLAW_TIP, roughness=0.45), solid_image("clawTip_tex", CLAW_TIP)), 0.10, 0.35),
        "leg": set_coat(attach_image(make_mat("leg", LEG_COL, roughness=0.55), solid_image("leg_tex", LEG_COL)), 0.08, 0.40),
        "eye": set_coat(attach_image(make_mat("eye", EYE_COL, roughness=0.12), solid_image("eye_tex", EYE_COL)), 0.35, 0.12),
        "highlight": attach_image(make_mat("highlight", HIGHLIGHT, roughness=0.22, emission=0.35), solid_image("highlight_tex", HIGHLIGHT)),
    }
    parts, bones, aperture, open_dir, body_c = build_meshes(mats, shell_img)
    for obj in parts:
        print(f"  {obj.name}: {triangle_count(obj)}")
    mesh = join_objects("Hermit", parts)
    fb = mesh.vertex_groups.get("body") or mesh.vertex_groups.new(name="body")
    missing = [i for i, v in enumerate(mesh.data.vertices) if not v.groups]
    if missing:
        fb.add(missing, 1.0, "REPLACE")
        print(f"filled {len(missing)} unweighted verts")
    settle_to_ground(mesh, bones)
    xs = [v.co.x for v in mesh.data.vertices]
    ys = [v.co.y for v in mesh.data.vertices]
    zs = [v.co.z for v in mesh.data.vertices]
    longest = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    target = 7.6 * CM  # just under 8 cm so feet/claws stay inside the budget
    if longest > 1e-6:
        fac = target / longest
        for v in mesh.data.vertices:
            v.co *= fac
        mesh.data.update()
        shifted = []
        for name, parent, head, tail in bones:
            shifted.append((name, parent, Vector(head) * fac, Vector(tail) * fac))
        bones[:] = shifted
        print(f"scaled by {fac:.3f} (longest {longest:.4f} -> {target:.4f})")
    settle_to_ground(mesh, bones)
    tris = triangle_count(mesh)
    print(f"joined mesh triangles: {tris}")
    if tris > 3000:
        raise SystemExit(f"too many triangles: {tris}")
    arm = build_armature(bones)
    arm.name = "HermitArmature"
    bind(mesh, arm)
    animate_idle(arm)
    animate_walk(arm)
    animate_hide(arm)
    animate_peek(arm)
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
