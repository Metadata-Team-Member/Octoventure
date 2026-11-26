"""Build the Octoventure soft-toon superb fairy-wren and export src/assets/models/wren.glb.

Run:
    /opt/blender/blender -b --python tools/blender/wren.py

A cute toon Malurus cyaneus (superb fairy-wren) in breeding-male colours:
the whole upper head and cheeks are bright sky-blue, with a wide black
mask from the beak through the eye to a black nape collar, a navy bib,
a brown body, cream belly, brown wings and a cocked blue-grey tail.
Head markings live on a 512x512 colour texture painted in 3D and baked
to a clean UV, so the edges stay smooth. Value contrast (light blue vs
mid brown vs dark mask) so the pattern reads for a colour-blind player.

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

Materials
---------
body, beak, eye, highlight, leg, tail, wing, wingEdge.

Female / eclipse retint:
  The male map is embedded on the `body` material (tools/blender/wren_male.png,
  also packed in the glb). Swap that image for tools/blender/wren_female.png
  (copied to src/assets/models/wren_female.png): head and bib become brown-grey
  #A09070, the mask rusty orange #D07838. tail, wing, wingEdge, belly/back
  colours in the map, beak, eye, highlight and leg stay as they are.
"""

from __future__ import annotations

import json
import math
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import bmesh
import numpy as np
import bpy
from mathutils import Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
GLB_PATH = ROOT / "src" / "assets" / "models" / "wren.glb"
PREVIEW_REPO = ROOT / "tools" / "blender" / "wren-preview.png"
PREVIEW_REPO_SIDE = ROOT / "tools" / "blender" / "wren-preview-side.png"
PREVIEW_REPO_FLY = ROOT / "tools" / "blender" / "wren-fly.png"
PREVIEW_REPO_SONG = ROOT / "tools" / "blender" / "wren-song.png"
PREVIEW_WORKSPACE = Path("/workspace/wren-preview.png")
PREVIEW_SIDE = Path("/workspace/wren-preview-side.png")
PREVIEW_FLY = Path("/workspace/wren-fly.png")
PREVIEW_SONG = Path("/workspace/wren-song.png")
MALE_TEX = ROOT / "tools" / "blender" / "wren_male.png"
FEMALE_TEX = ROOT / "tools" / "blender" / "wren_female.png"
FEMALE_TEX_PUBLIC = ROOT / "src" / "assets" / "models" / "wren_female.png"

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
WING_EDGE = (0x5C / 255, 0x44 / 255, 0x2C / 255, 1.0)  # #5C442C trailing-edge shade
BELLY = (0xF2 / 255, 0xEA / 255, 0xD8 / 255, 1.0)      # #F2EAD8 pale cream-grey
TAIL = (0x4A / 255, 0x72 / 255, 0x9A / 255, 1.0)       # #4A729A darker blue-grey than the crown
BEAK = (0x2C / 255, 0x24 / 255, 0x1C / 255, 1.0)       # #2C241C
EYE = (0x14 / 255, 0x14 / 255, 0x16 / 255, 1.0)
HIGHLIGHT = (1.0, 1.0, 1.0, 1.0)
LEG = (0x32 / 255, 0x28 / 255, 0x20 / 255, 1.0)        # #322820 dark twiggy legs
FEMALE_HEAD = (0xA0 / 255, 0x90 / 255, 0x70 / 255, 1.0)  # #A09070
FEMALE_MASK = (0xD0 / 255, 0x78 / 255, 0x38 / 255, 1.0)  # #D07838

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
    color = tuple(color[:3]) + (1.0,)
    mat.diffuse_color = color
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


def _smoothstep(a, b, x):
    if b == a:
        return 0.0 if x < a else 1.0
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


def _lerp3(a, b, t):
    t = max(0.0, min(1.0, t))
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


def wren_body_color(p, head_c, head_s, body_c, female=False):
    """Breeding-male (or female) colour at a point on the unified body."""
    p = Vector(p)
    dx = (p.x - head_c.x) / max(head_s.x, 1e-9)
    dy = (p.y - head_c.y) / max(head_s.y, 1e-9)
    dz = (p.z - head_c.z) / max(head_s.z, 1e-9)
    rh = math.sqrt(dx * dx + dy * dy + dz * dz)
    lon = math.degrees(math.atan2(dx, -dy))
    lat = math.degrees(math.atan2(dz, math.hypot(dx, dy) + 1e-12))
    alon = abs(lon)

    crown_c = CROWN[:3]
    cheek_c = EAR[:3]
    mask_c = MASK[:3]
    nape_c = NAPE[:3]
    bib_c = THROAT[:3]
    back_c = BACK[:3]
    belly_c = BELLY[:3]
    if female:
        crown_c = cheek_c = bib_c = nape_c = FEMALE_HEAD[:3]
        mask_c = FEMALE_MASK[:3]

    # Cream belly on the underside of the torso, not under the chin.
    under = (body_c.z - 0.10 * CM - p.z) / (0.95 * CM)
    belly_w = _smoothstep(0.05, 0.95, under) * _smoothstep(-0.55 * CM, -0.05 * CM, p.y)
    col = _lerp3(back_c, belly_c, belly_w)

    # Head weight: solid on the skull, fading down the neck into the body.
    head_w = 1.0 - _smoothstep(0.98, 1.55, rh)

    # Default head: bright sky-blue, slightly different on the cheeks.
    cheek_w = (
        _smoothstep(40.0, 58.0, alon)
        * (1.0 - _smoothstep(125.0, 150.0, alon))
        * _smoothstep(-28.0, -8.0, lat)
        * (1.0 - _smoothstep(38.0, 55.0, lat))
    )
    head_col = _lerp3(crown_c, cheek_c, cheek_w)

    # Wide soft mask through the eye, wrapping to a nape collar.
    # Eye sits at about lon ±76, lat +8; band is wider than the eye.
    lat_c = 8.0 + 10.0 * _smoothstep(110.0, 180.0, alon)
    half = 38.0 + 8.0 * _smoothstep(120.0, 180.0, alon)
    lon_mask = _smoothstep(8.0, 24.0, alon)
    mask_amt = lon_mask * (1.0 - _smoothstep(half - 10.0, half + 8.0, abs(lat - lat_c)))
    # Fuller black collar on the back of the skull.
    nape_amt = (
        _smoothstep(115.0, 145.0, alon)
        * (1.0 - _smoothstep(48.0, 70.0, lat))
        * _smoothstep(-15.0, 5.0, lat)
    )
    black_amt = max(mask_amt, nape_amt)
    head_col = _lerp3(head_col, _lerp3(mask_c, nape_c, nape_amt), black_amt)

    # Navy bib under the beak and down onto the upper chest.
    bib_head = (
        (1.0 - _smoothstep(48.0, 72.0, alon))
        * (1.0 - _smoothstep(0.0, 16.0, lat))
        * _smoothstep(-85.0, 2.0, lat)
    )
    under_face = (
        _smoothstep(-2.90 * CM, -2.20 * CM, p.y)
        * (1.0 - _smoothstep(-0.15 * CM, 0.55 * CM, p.y))
        * (1.0 - _smoothstep(0.55 * CM, 1.05 * CM, abs(p.x)))
        * (1.0 - _smoothstep(head_c.z - 0.15 * CM, head_c.z + 0.15 * CM, p.z))
        * _smoothstep(1.10 * CM, 1.55 * CM, p.z)
    )
    bib_amt = max(bib_head, under_face)
    bib_amt *= (1.0 - black_amt * 0.90)
    head_col = _lerp3(head_col, bib_c, bib_amt)

    return _lerp3(col, head_col, max(head_w, bib_amt * 0.85 * (1.0 if not female or True else 1.0)))


def unwrap_body(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if obj.data.uv_layers.active is None:
        obj.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(66.0),
        island_margin=0.04,
        area_weight=0.5,
        correct_aspect=True,
        scale_to_bounds=False,
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)


def _raster_tri(acc, wgt, S, uv0, uv1, uv2, p0, p1, p2, color_fn):
    ax, ay = uv0[0] * S - 0.5, uv0[1] * S - 0.5
    bx, by = uv1[0] * S - 0.5, uv1[1] * S - 0.5
    cx, cy = uv2[0] * S - 0.5, uv2[1] * S - 0.5
    xmin = max(0, int(math.floor(min(ax, bx, cx))))
    xmax = min(S - 1, int(math.ceil(max(ax, bx, cx))))
    ymin = max(0, int(math.floor(min(ay, by, cy))))
    ymax = min(S - 1, int(math.ceil(max(ay, by, cy))))
    denom = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(denom) < 1e-14:
        return
    p0 = Vector(p0)
    p1 = Vector(p1)
    p2 = Vector(p2)
    for y in range(ymin, ymax + 1):
        py = y + 0.5
        for x in range(xmin, xmax + 1):
            px = x + 0.5
            w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom
            w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom
            w2 = 1.0 - w0 - w1
            if w0 < -0.001 or w1 < -0.001 or w2 < -0.001:
                continue
            s = w0 + w1 + w2
            p = p0 * (w0 / s) + p1 * (w1 / s) + p2 * (w2 / s)
            acc[y, x] += np.array(color_fn(p), dtype=np.float32)
            wgt[y, x] += 1.0


def _dilate_filled(acc, wgt, steps=4):
    filled = wgt > 0
    img = acc.copy()
    for _ in range(steps):
        new = img.copy()
        new_f = filled.copy()
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            rolled = np.roll(np.roll(img, dy, 0), dx, 1)
            was = np.roll(np.roll(filled, dy, 0), dx, 1)
            take = (~new_f) & was
            new[take] = rolled[take]
            new_f[take] = True
        img, filled = new, new_f
    return img, filled


def bake_body_texture(obj, head_c, head_s, body_c, female=False, size=512):
    """Bake a 512 texture by rasterising UVs with a 3D colour function."""
    S = size * 2
    acc = np.zeros((S, S, 3), dtype=np.float32)
    wgt = np.zeros((S, S), dtype=np.float32)
    mesh = obj.data
    uv_layer = mesh.uv_layers.active
    if uv_layer is None:
        raise RuntimeError("body has no UV map")
    uvs = uv_layer.data

    def color_fn(p):
        return wren_body_color(p, head_c, head_s, body_c, female=female)

    for poly in mesh.polygons:
        n = len(poly.loop_indices)
        if n < 3:
            continue
        for i in range(1, n - 1):
            l0, l1, l2 = poly.loop_indices[0], poly.loop_indices[i], poly.loop_indices[i + 1]
            v0, v1, v2 = poly.vertices[0], poly.vertices[i], poly.vertices[i + 1]
            _raster_tri(
                acc, wgt, S,
                uvs[l0].uv, uvs[l1].uv, uvs[l2].uv,
                mesh.vertices[v0].co, mesh.vertices[v1].co, mesh.vertices[v2].co,
                color_fn,
            )
    mask = wgt > 0
    acc[mask] /= wgt[mask, None]
    acc[~mask] = np.array(BACK[:3], dtype=np.float32)
    acc, filled = _dilate_filled(acc, wgt, steps=5)
    acc[~filled] = np.array(BACK[:3], dtype=np.float32)
    # Downsample 2x for softer anti-aliased edges.
    img = acc.reshape(size, 2, size, 2, 3).mean(axis=(1, 3))
    return img


def save_blender_png(arr, path, name):
    """arr is float RGB, v=0 at the bottom, size x size."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    h, w, _ = arr.shape
    if name in bpy.data.images:
        im = bpy.data.images[name]
        bpy.data.images.remove(im)
    im = bpy.data.images.new(name, width=w, height=h, alpha=False)
    pixels = np.ones((h, w, 4), dtype=np.float32)
    pixels[..., :3] = np.clip(arr, 0.0, 1.0)
    im.pixels.foreach_set(pixels.reshape(-1))
    im.filepath_raw = str(path)
    im.file_format = "PNG"
    im.save()
    im.pack()
    print(f"texture: {path} ({path.stat().st_size} bytes)")
    return im


def make_textured_mat(name, image, fallback, roughness=0.55):
    mat = set_coat(make_mat(name, fallback, roughness=roughness, metallic=0.0), 0.10, 0.35)
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image
    tex.interpolation = "Linear"
    tex.extension = "EXTEND"
    tex.location = (-280, 200)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.nodes.active = tex
    tex.select = True
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


def key_euler(pb, frame, euler, interpolation="BEZIER", mode="XYZ"):
    pb.rotation_mode = mode
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



def paint_wren_body(obj, mats, body_c, head_c=None, head_s=None):
    """Cream belly on the underside; the rest of the body stays brown.
    Head markings are separate smooth shells, not painted faces.
    """
    belly_i = ensure_slot(obj, mats["belly"])
    back_i = ensure_slot(obj, mats["back"])
    for poly in obj.data.polygons:
        c = poly.center
        n = poly.normal
        if n.z < -0.50 and c.z < body_c.z - 0.15 * CM and c.y > -0.2 * CM:
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


def apply_shrinkwrap(obj, target, offset):
    """Hug a patch to the body so markings sit flush, not like a hat."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new("sw", "SHRINKWRAP")
    mod.target = target
    mod.wrap_method = "NEAREST_SURFACEPOINT"
    mod.offset = offset
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)
    shade_smooth(obj)
    return obj


def delete_faces(obj, keep_fn):
    """Drop faces for which keep_fn(center) is False, in object space."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    drop = [f for f in bm.faces if not keep_fn(f.calc_center_median())]
    if drop:
        bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def recalc_normals(obj):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)


def add_cap_shell(name, target, center, scale, direction, angle_deg, mat, group,
                  segments=20, rings=10, offset=0.007):
    """A thin ellipsoidal cap sitting just outside the head. The cut is a
    clean circle, so the marking reads as a smooth cartoon shape, not a
    blotch. Named materials stay on the shells so female retint still works.
    """
    sph = add_uv_sphere(name, 1.0, segments, rings, center, scale=scale, poles="Z")
    direction = Vector(direction)
    if direction.length < 1e-9:
        direction = Vector((0.0, 0.0, 1.0))
    direction = direction.normalized()
    limit = math.radians(angle_deg)

    def keep(co):
        v = co - center
        if v.length < 1e-12:
            return False
        return v.normalized().angle(direction) <= limit

    delete_faces(sph, keep)
    if len(sph.data.polygons) == 0:
        print("WARNING: empty cap", name)
        return sph
    # Uniform scale keeps the cap a smooth ellipsoid with a clean circular
    # outline. Per-vertex snap followed the body's faceted surface and
    # turned the markings back into blotches.
    fit_shell_outside(sph, target, center, offset * CM)
    recalc_normals(sph)
    shade_smooth(sph)
    set_material(sph, mat)
    assign_group(sph, group)
    return sph


def add_zone_shell(name, target, center, scale, axis, min_deg, max_deg, mat, group,
                   lon_keep=None, segments=32, rings=16, offset=0.008):
    """A thin spherical belt (and optional longitude window) on the head.
    Used for the black mask-to-nape band so it reads as a stripe, not a cheek patch.
    """
    sph = add_uv_sphere(name, 1.0, segments, rings, center, scale=scale, poles="Z")
    axis = Vector(axis)
    if axis.length < 1e-9:
        axis = Vector((0.0, 0.0, 1.0))
    axis = axis.normalized()
    ref = Vector((0.0, -1.0, 0.0))
    ref = ref - axis * ref.dot(axis)
    if ref.length < 1e-9:
        ref = Vector((1.0, 0.0, 0.0))
    ref = ref.normalized()

    def keep(co):
        v = co - center
        if v.length < 1e-12:
            return False
        vn = v.normalized()
        ang = math.degrees(vn.angle(axis))
        if not (min_deg <= ang <= max_deg):
            return False
        if lon_keep is None:
            return True
        radial = vn - axis * vn.dot(axis)
        if radial.length < 1e-12:
            return False
        radial = radial.normalized()
        lon = math.degrees(math.atan2(axis.dot(ref.cross(radial)), ref.dot(radial)))
        return lon_keep(lon)

    delete_faces(sph, keep)
    if len(sph.data.polygons) == 0:
        print("WARNING: empty zone", name)
        return sph
    fit_shell_outside(sph, target, center, offset * CM)
    recalc_normals(sph)
    shade_smooth(sph)
    set_material(sph, mat)
    assign_group(sph, group)
    return sph


def fit_shell_outside(obj, target, center, offset):
    """Scale the whole cap uniformly so it sits just outside the body."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = target.evaluated_get(deps)
    factors = []
    for v in obj.data.vertices:
        outward = v.co - center
        if outward.length < 1e-12:
            continue
        direction = outward.normalized()
        origin = center + direction * (0.04 * CM)
        ok, loc, _normal, _idx = ev.ray_cast(origin, direction, distance=4.0 * CM)
        if ok:
            body_r = (Vector(loc) - center).length
            cap_r = outward.length
            if cap_r > 1e-12:
                factors.append(body_r / cap_r)
    if not factors:
        print(f"  cap {obj.name}: no body hits, left unscaled")
        return
    factors.sort()
    # Drop rays that missed the skull and hit the torso or far side.
    # Prefer hits that land on the skull itself, not the torso or a far side.
    kept = [f for f in factors if 0.80 <= f <= 0.98]
    if not kept:
        kept = [f for f in factors if 0.75 <= f <= 1.05]
    if not kept:
        mid = factors[len(factors) // 2]
        kept = [mid]
        print(f"  cap {obj.name}: all hits out of range, used median {mid:.4f}")
    factor = max(kept)
    for v in obj.data.vertices:
        radial = v.co - center
        if radial.length < 1e-12:
            continue
        v.co = center + radial * factor + radial.normalized() * offset
    obj.data.update()
    print(
        f"  cap {obj.name}: uniform scale {factor:.4f} "
        f"(raw min {factors[0]:.4f} max {factors[-1]:.4f}, kept {len(kept)}/{len(factors)})"
    )


def add_cocked_tail(name, base, tip, width, thickness, mats, groups):
    """One opaque, slightly fanned tail with a single rounded tip."""
    mid = base.lerp(tip, 0.55)
    length = (tip - base).length
    fan = add_oriented_ellipsoid(
        name, mid, tip - base,
        (width, thickness, length * 0.52),
        segments=12, rings=8,
    )
    # Soften the tip to a rounded end and slim the base a little.
    axis = (tip - base).normalized()
    for v in fan.data.vertices:
        t = (v.co - base).dot(axis) / max(length, 1e-9)
        t = max(0.0, min(1.0, t))
        if t < 0.18:
            profile = 0.55 + 0.45 * (t / 0.18)
        elif t > 0.62:
            u = (t - 0.62) / 0.38
            profile = math.sqrt(max(0.0, 1.0 - u * u))
            profile = max(profile, 0.22)
        else:
            profile = 1.0
        center = base + axis * (t * length)
        offset = v.co - center
        along = offset.dot(axis) * axis
        perp = offset - along
        v.co = center + along + perp * profile
    fan.data.update()
    shade_smooth(fan)
    set_material(fan, mats["tail"])
    assign_chain_weights(fan, [base, mid, tip], list(groups), parent_bone="body")
    return fan

def even_mesh(obj, voxel, target_tris):
    """Voxel remesh + decimate so painted markings sit on even faces."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new("RM", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier=mod.name)
    tris = triangle_count(obj)
    print(f"  remesh {obj.name}: {tris} tris")
    if tris > target_tris:
        d = obj.modifiers.new("DC", "DECIMATE")
        d.ratio = min(1.0, target_tris / max(tris, 1))
        bpy.ops.object.modifier_apply(modifier=d.name)
        print(f"  decimate {obj.name}: {triangle_count(obj)} tris")
    shade_smooth(obj)
    obj.select_set(False)
    return obj


def add_leaf(name, base, tip, width, thickness, segments=10, rings=6):
    """A flat, tapered, rounded-tip leaf (for wings), opaque and smooth."""
    direction = Vector(tip) - Vector(base)
    length = direction.length
    axis = direction.normalized()
    mid = Vector(base).lerp(Vector(tip), 0.55)
    obj = add_oriented_ellipsoid(
        name, mid, direction,
        (thickness, width, length * 0.52),
        segments=segments, rings=rings,
    )
    for v in obj.data.vertices:
        t = (v.co - Vector(base)).dot(axis) / max(length, 1e-9)
        t = max(0.0, min(1.0, t))
        if t < 0.55:
            profile = 0.55 + 0.45 * (t / 0.55)
        else:
            u = (t - 0.55) / 0.45
            profile = math.sqrt(max(0.0, 1.0 - u * u))
            profile = max(profile, 0.12)
        center = Vector(base) + axis * (t * length)
        offset = v.co - center
        # Keep the thickness axis (the smallest component of offset along
        # a guess of 'thin' is hard); scale the part of offset perpendicular
        # to the axis, but less so along the thinnest rest direction.
        # After orientation, the thin axis is roughly the shortest of offset
        # if we scale only the in-plane width. Split offset into axis / rest.
        along = offset.dot(axis) * axis
        perp = offset - along
        v.co = center + along + perp * profile
    obj.data.update()
    shade_smooth(obj)
    return obj


def add_folded_wing(name, side, shoulder, mid, tip, mats, groups):
    """A soft, rounded leaf-shaped wing: smooth leading edge, three
    gentle rounded feather tips, elliptical thickness, smooth shaded.
    No sharp creases or corrugated scallop ribs.
    """
    s = 1.0 if side >= 0 else -1.0
    length_axis = (tip - shoulder).normalized()
    out = Vector((s, 0.0, 0.0))
    chord = length_axis.cross(out)
    if chord.length < 1e-9:
        chord = Vector((0.0, 0.0, 1.0))
    chord = chord.normalized()
    if chord.z < 0:
        chord = -chord
    out = length_axis.cross(chord).normalized()
    if out.x * s < 0:
        out = -out
        chord = length_axis.cross(out).normalized()
        if chord.z < 0:
            chord = -chord
            out = length_axis.cross(chord).normalized()
            if out.x * s < 0:
                out = -out

    length = (tip - shoulder).length
    origin = shoulder + out * (0.08 * CM)
    half = 0.16 * CM  # slightly plump so the rounded rim reads
    n_sc = 3

    def _smoothstep(x):
        x = max(0.0, min(1.0, x))
        return x * x * (3.0 - 2.0 * x)

    def lead_v(u):
        return (0.10 + 0.48 * math.sin(math.pi * min(1.0, u / 0.90))) * CM

    def trail_v(u):
        base = (-0.05 - 0.40 * math.sin(math.pi * min(1.0, u * 0.96))) * CM
        # Raised-cosine lobes: C-infinity, 0 at the joints, no V-notch crease.
        if u <= 0.36:
            scallop = 0.0
        else:
            tt = (u - 0.36) / 0.64
            scallop = 0.5 * (1.0 - math.cos(2.0 * math.pi * n_sc * tt))
            fade = 1.0
            if tt < 0.14:
                fade = _smoothstep(tt / 0.14)
            elif tt > 0.86:
                fade = _smoothstep((1.0 - tt) / 0.14)
            scallop *= fade
        tip_round = 1.0
        if u > 0.84:
            tip_round = math.sqrt(max(0.0, 1.0 - ((u - 0.84) / 0.16) ** 2))
        return (base - 0.05 * CM * scallop) * tip_round

    def thick_at(u, t):
        """Elliptical pad: t=0 trailing, t=1 leading. Soft rounded rim,
        slightly tapered at the root and tip."""
        x = 2.0 * t - 1.0
        rim = (max(0.0, 1.0 - abs(x) ** 1.7)) ** (1.0 / 1.7)
        rim = 0.22 + 0.78 * rim
        taper = 1.0
        if u < 0.08:
            taper = 0.60 + 0.40 * _smoothstep(u / 0.08)
        elif u > 0.80:
            taper = 0.38 + 0.62 * math.sqrt(max(0.0, 1.0 - ((u - 0.80) / 0.20) ** 2))
        return half * rim * taper

    def pt(u, t, sign):
        v = trail_v(u) * (1.0 - t) + lead_v(u) * t
        h = thick_at(u, t) * sign
        return origin + length_axis * (u * length) + chord * v + out * h

    nu, nv = 14, 7  # length x chord segments
    bm = bmesh.new()
    top = [[None] * (nv + 1) for _ in range(nu + 1)]
    bot = [[None] * (nv + 1) for _ in range(nu + 1)]
    for i in range(nu + 1):
        u = i / nu
        for j in range(nv + 1):
            t = j / nv
            top[i][j] = bm.verts.new(pt(u, t, 1.0))
            bot[i][j] = bm.verts.new(pt(u, t, -1.0))
    bm.verts.ensure_lookup_table()

    def quad(a, b, c, d):
        bm.faces.new((a, b, c, d))

    # Top (normal +out) and bottom (normal -out).
    for i in range(nu):
        for j in range(nv):
            quad(top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1])
            quad(bot[i][j], bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j])
    # Rim: trailing, leading, root, tip.
    for i in range(nu):
        quad(top[i][0], bot[i][0], bot[i + 1][0], top[i + 1][0])
        quad(top[i][nv], top[i + 1][nv], bot[i + 1][nv], bot[i][nv])
    for j in range(nv):
        quad(top[0][j], top[0][j + 1], bot[0][j + 1], bot[0][j])
        quad(top[nu][j], bot[nu][j], bot[nu][j + 1], top[nu][j + 1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)

    obj.data.materials.clear()
    obj.data.materials.append(mats["wing"])
    obj.data.materials.append(mats["wingEdge"])
    for poly in obj.data.polygons:
        rel = poly.center - origin
        u = rel.dot(length_axis) / max(length, 1e-9)
        v = rel.dot(chord)
        poly.material_index = 1 if (u >= 0.48 and v < -0.02 * CM) else 0

    assign_chain_weights(obj, [shoulder, mid, tip], list(groups), parent_bone=None)
    shade_smooth(obj)
    return obj


def build_meshes(mats):
    """Return (parts, bones). Face toward Blender -Y. Feet on Z=0."""
    parts = []
    bones = []

    # One plump bird: body, neck and head are unioned, then smoothed.
    # Beak tip near y=-3.7 cm, rump near y=+2.2 cm (body ~6 cm).
    body_c = Vector((0.0, 0.50, 2.08)) * CM
    body_s = Vector((1.92, 2.30, 1.48)) * CM
    head_c = Vector((0.0, -1.65, 2.82)) * CM
    head_s = Vector((1.22, 1.28, 1.12)) * CM
    neck_c = Vector((0.0, -0.60, 2.48)) * CM
    neck_s = Vector((1.38, 1.22, 1.18)) * CM

    body = add_uv_sphere("body", 1.0, 16, 12, body_c, scale=body_s, poles="Y")
    neck = add_uv_sphere("neck", 1.0, 14, 10, neck_c, scale=neck_s, poles="Y")
    head = add_uv_sphere("head", 1.0, 16, 12, head_c, scale=head_s, poles="Y")
    body = boolean_union(body, [neck, head])
    body.name = "body"
    smooth_mesh(body, iterations=8, factor=0.55)
    # Head / neck / body weights: a tight skull split so eyes and shells stay on.
    for name in ("head", "neck", "body"):
        if not body.vertex_groups.get(name):
            body.vertex_groups.new(name=name)
    vg_h, vg_n, vg_b = body.vertex_groups["head"], body.vertex_groups["neck"], body.vertex_groups["body"]
    for i, v in enumerate(body.data.vertices):
        if v.co.y <= head_c.y + 0.35 * CM:
            vg_h.add([i], 1.0, "REPLACE")
        elif v.co.y < -0.10 * CM:
            vg_n.add([i], 1.0, "REPLACE")
        else:
            vg_b.add([i], 1.0, "REPLACE")
    unwrap_body(body)
    male_arr = bake_body_texture(body, head_c, head_s, body_c, female=False)
    female_arr = bake_body_texture(body, head_c, head_s, body_c, female=True)
    male_img = save_blender_png(male_arr, MALE_TEX, "wren_male")
    female_img = save_blender_png(female_arr, FEMALE_TEX, "wren_female")
    FEMALE_TEX_PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(FEMALE_TEX, FEMALE_TEX_PUBLIC)
    body_mat = make_textured_mat("body", male_img, BACK)
    mats["body"] = body_mat
    set_material(body, body_mat)
    parts.append(body)

    # Short, fine beak pointing forward from the face, not hanging down.
    beak_base = Vector((0.0, -2.85, 2.78)) * CM
    beak_tip = Vector((0.0, -3.55, 2.76)) * CM
    beak = add_oriented_ellipsoid(
        "beak", beak_base.lerp(beak_tip, 0.55), beak_tip - beak_base,
        (0.10 * CM, 0.08 * CM, 0.38 * CM),
        segments=8, rings=6,
    )
    set_material(beak, mats["beak"])
    assign_group(beak, "beak")
    parts.append(beak)
    jaw_base = beak_base + Vector((0.0, 0.02, -0.06)) * CM
    jaw_tip = beak_tip + Vector((0.0, 0.04, -0.05)) * CM
    jaw = add_oriented_ellipsoid(
        "jaw", jaw_base.lerp(jaw_tip, 0.55), jaw_tip - jaw_base,
        (0.08 * CM, 0.06 * CM, 0.30 * CM),
        segments=7, rings=5,
    )
    set_material(jaw, mats["beak"])
    assign_group(jaw, "jaw")
    parts.append(jaw)

    # Big glossy eyes sitting in the painted black mask, white highlight on top.
    eye_bones = {}
    eye_r = 0.44 * CM
    for side, name in ((1, "eye_L"), (-1, "eye_R")):
        s = float(side)
        guess = on_ellipsoid(head_c, head_s, (s * 0.82, -0.20, 0.10), 1.00)
        surface, look = snap_to_mesh(body, guess, inset=0.0)
        loc = surface - look * (eye_r * 0.22)
        eyeball = add_uv_sphere(name, eye_r, 14, 10, loc)
        set_material(eyeball, mats["eye"])
        assign_group(eyeball, "head")
        parts.append(eyeball)
        hl_dir = (look + Vector((0.0, 0.0, 0.70))).normalized()
        hl = add_uv_sphere(name + "_hl", 0.16 * CM, 8, 5, loc + hl_dir * (eye_r * 0.78))
        set_material(hl, mats["highlight"])
        assign_group(hl, "head")
        parts.append(hl)
        eye_bones[name] = (loc, loc + look * (0.18 * CM))

    # Folded wings along the flanks; outer bone extends the primaries for fly.
    for side, tag in ((1, "L"), (-1, "R")):
        s = float(side)
        shoulder = Vector((s * 1.58, 0.00, 2.22)) * CM
        mid = Vector((s * 1.68, 1.40, 2.05)) * CM
        tip = Vector((s * 1.62, 2.95, 1.70)) * CM
        names = [f"wing_{tag}", f"wing_{tag}2"]
        wing = add_folded_wing(f"wing_{tag}", s, shoulder, mid, tip, mats, names)
        parts.append(wing)
        bones.append((names[0], "body", shoulder, mid))
        bones.append((names[1], names[0], mid, tip))

    # One slightly fanned tail, ~1.0x body length, cocked 50 degrees from vertical.
    tail_base = Vector((0.0, 2.15, 2.05)) * CM
    body_len = (beak_tip - tail_base).length
    tail_len = body_len * 1.00
    tail_dir = Vector((0.0, math.sin(r(50.0)), math.cos(r(50.0)))).normalized()
    tail_tip = tail_base + tail_dir * tail_len
    tail_mid = tail_base.lerp(tail_tip, 0.48)
    parts.append(add_cocked_tail(
        "tail", tail_base, tail_tip, width=0.52 * CM, thickness=0.20 * CM,
        mats=mats, groups=["tail1", "tail2"],
    ))

    # Shorter, slightly thicker twiggy legs. Three forward toes and a hallux, on z=0.
    for side, tag in ((1, "L"), (-1, "R")):
        s = float(side)
        hip = Vector((s * 0.85, 0.30, 1.18)) * CM
        ankle = Vector((s * 0.90, 0.16, 0.30)) * CM
        toe = Vector((s * 0.90, -0.10, 0.06)) * CM
        names = [f"leg_{tag}", f"foot_{tag}"]
        leg = add_tapered_tube(
            f"leg_{tag}", [hip, ankle, toe],
            [0.20 * CM, 0.15 * CM, 0.12 * CM],
            verts=6, extra_rings=0, cap=True,
        )
        set_material(leg, mats["leg"])
        assign_chain_weights(leg, [hip, ankle, toe], names, parent_bone="body")
        parts.append(leg)
        origin = Vector((s * 0.90, -0.04, 0.08)) * CM
        spreads = (-0.20, 0.0, 0.20, -0.02)
        reaches = (0.36, 0.44, 0.36, -0.24)
        y_dirs = (-1.0, -1.0, -1.0, 1.0)
        for i, (sp, reach, yd) in enumerate(zip(spreads, reaches, y_dirs)):
            tip_t = Vector((
                origin.x + s * sp * CM,
                origin.y + yd * reach * CM,
                0.05 * CM,
            ))
            digit = add_tapered_tube(
                f"{tag}_toe{i}", [origin, tip_t],
                [0.10 * CM, 0.06 * CM],
                verts=5, extra_rings=0, cap=True,
            )
            set_material(digit, mats["leg"])
            assign_group(digit, names[1])
            parts.append(digit)
        bones.append((names[0], "body", hip, ankle))
        bones.append((names[1], names[0], ankle, toe))

    core = [
        ("root", None, Vector((0.0, 0.0, 0.0)), Vector((0.0, 0.0, 0.5)) * CM),
        ("body", "root", Vector((0.0, 0.2, 2.05)) * CM, Vector((0.0, 1.5, 2.10)) * CM),
        ("neck", "body", Vector((0.0, -0.55, 2.50)) * CM, Vector((0.0, -0.55, 2.50)) * CM + Vector((0.0, -0.70, 0.28)) * CM),
        ("head", "neck", Vector((0.0, -1.35, 2.75)) * CM, Vector((0.0, -2.70, 2.78)) * CM),
        ("beak", "head", beak_base, beak_tip),
        ("jaw", "head", jaw_base, jaw_tip),
        ("tail1", "body", tail_base, tail_mid),
        ("tail2", "tail1", tail_mid, tail_tip),
    ]
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
        key_euler(body, fr, (r(-8), 0, 0))
        # ZYX: spread (Z) first, then twist around the bone length (Y) so
        # the leaf lies flat and horizontal, then a small X flap.
        flap = 8 * up - 14 * in_stroke
        key_euler(w_l, fr, (r(flap), r(90), r(-90)), mode="ZYX")
        key_euler(w_r, fr, (r(flap), r(-90), r(90)), mode="ZYX")
        key_euler(w_l2, fr, (0, 0, 0), mode="ZYX")
        key_euler(w_r2, fr, (0, 0, 0), mode="ZYX")
        # Fold the legs up under the belly, feet tucked in.
        key_euler(leg_l, fr, (r(108), 0, r(-6)))
        key_euler(leg_r, fr, (r(108), 0, r(6)))
        key_euler(arm.pose.bones["foot_L"], fr, (r(55), 0, 0))
        key_euler(arm.pose.bones["foot_R"], fr, (r(55), 0, 0))
        key_euler(tail1, fr, (r(10), 0, 0))
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
    view_34 = ((14.0, -17.0, 11.0), (0.0, 0.0, 2.9))
    view_side = ((19.0, 0.2, 6.4), (0.0, 0.4, 2.8))
    PREVIEW_REPO.parent.mkdir(parents=True, exist_ok=True)
    _shot(PREVIEW_REPO, *view_34, "idle", 12)
    shutil.copy2(PREVIEW_REPO, PREVIEW_WORKSPACE)
    _shot(PREVIEW_SIDE, *view_side, "idle", 12)
    shutil.copy2(PREVIEW_SIDE, PREVIEW_REPO_SIDE)
    _shot(PREVIEW_FLY, *view_34, "fly", 3)
    shutil.copy2(PREVIEW_FLY, PREVIEW_REPO_FLY)
    _shot(PREVIEW_SONG, *view_34, "song", 8)
    shutil.copy2(PREVIEW_SONG, PREVIEW_REPO_SONG)
    # QA
    _shot(Path("/tmp/wren-top.png"), (0.2, -0.4, 24.0), (0.0, 0.6, 0.0), "idle", 12)
    _shot(Path("/tmp/wren-fly-side.png"), *view_side, "fly", 3)
    _shot(Path("/tmp/wren-hop.png"), *view_34, "hop", 4)
    _shot(Path("/tmp/wren-peck.png"), *view_34, "peck", 6)
    _shot(Path("/tmp/wren-song-side.png"), *view_side, "song", 8)
    _shot(Path("/tmp/wren-front.png"), (0.2, -20.0, 6.2), (0.0, -0.4, 2.7), "idle", 12)
    _shot(Path("/tmp/wren-fly-front.png"), (0.2, -22.0, 6.5), (0.0, 0.0, 2.8), "fly", 3)

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
    if path.stat().st_size > 300 * 1024:
        raise SystemExit(f"glb is over 300 KB: {path.stat().st_size}")
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
        "wing": set_coat(make_mat("wing", WING, roughness=0.55, metallic=0.0), 0.10, 0.35),
        "wingEdge": set_coat(make_mat("wingEdge", WING_EDGE, roughness=0.58, metallic=0.0), 0.08, 0.35),
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
