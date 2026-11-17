// Small low-poly model helpers (all built from primitives - no asset files needed).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** colour a geometry with a flat vertex colour and make it non-indexed for merging */
export function tint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
/** set PARTS.on = true before building models to keep each primitive's raw triangles on `geometry.userData.parts` (used by the tree-integrity audit) */
export const PARTS = { on: false };
export function merge(list) {
  const g = mergeGeometries(list, false);
  if (PARTS.on) g.userData.parts = list.map((p) => Float32Array.from(p.attributes.position.array));
  return g;
}

const M = new THREE.Matrix4();
export function at(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  M.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return geo.applyMatrix4(M);
}

/** merge coincident corners and recompute normals so a faceted primitive shades as one soft, rounded surface (t256u) */
export function smooth(geo) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  return g;
}
/** a soft puff of foliage / a pebble: a smooth-shaded icosphere */
export const puff = (r, detail = 1) => smooth(new THREE.IcosahedronGeometry(r, detail));
/** bevelled box (rounded edges) - the friendly replacement for raw BoxGeometry */
export function rbox(w, h, d, r = 0.08, seg = 1) {
  const rr = Math.max(0.002, Math.min(r, Math.min(w, h, d) * 0.5 - 1e-3));
  const g = new RoundedBoxGeometry(w, h, d, seg, rr);
  g.deleteAttribute('uv');
  return g;
}
/** like tint(), but a vertical gradient (darker at the base): cheap fake ambient occlusion that makes clumps read as soft volumes */
export function tintGrad(geo, hexBase, hexTip, y0 = null, y1 = null) {
  const g = tint(geo, hexBase);
  const p = g.attributes.position, c = g.attributes.color, a = new THREE.Color(hexBase), b = new THREE.Color(hexTip);
  let lo = y0, hi = y1;
  if (lo === null || hi === null) { lo = Infinity; hi = -Infinity; for (let i = 0; i < p.count; i++) { lo = Math.min(lo, p.getY(i)); hi = Math.max(hi, p.getY(i)); } }
  const t = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const k = Math.min(1, Math.max(0, (p.getY(i) - lo) / (hi - lo || 1))); t.copy(a).lerp(b, k); c.setXYZ(i, t.r, t.g, t.b); }
  return g;
}
/**
 * a soft leaf / grass blade: a short ribbon that bends outward (+x) and narrows to a ROUNDED tip (not a knife point).
 * Normals lean up and out, so a tuft lights as one soft clump (the Animal Crossing grass trick) rather than as flat cards.
 */
export function blade(h, w, bend = 0.3, seg = 3) {
  const pos = [], nrm = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, y = h * t * (1 - 0.18 * bend * t), x = bend * h * t * t, hw = w * 0.5 * (1 - 0.45 * t * t);
    pos.push(x, y, -hw, x, y, hw);
    const nx = 0.35 + bend * t, l = Math.hypot(nx, 1); nrm.push(nx / l, 1 / l, 0, nx / l, 1 / l, 0);
  }
  // rounded tip: two extra points on a little arc
  const tx = bend * h * 1.06, ty = h * (1 - 0.18 * bend) + w * 0.18, tw = w * 0.5 * 0.55 * 0.5;
  pos.push(tx, ty, -tw, tx, ty, tw); nrm.push(0.5, 0.86, 0, 0.5, 0.86, 0);
  const top = seg + 1;
  for (let i = 0; i < top; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

/** jitter a subdivided icosahedron into a rounded pebble / boulder (deterministic); smooth-shaded, no sharp facets */
export function rockGeometry(detail = 1) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv'), 1e-4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const j = 0.86 + 0.14 * (0.5 + 0.5 * Math.sin(x * 3.1 + z * 2.3 + 1.7)) + 0.08 * Math.sin(y * 4.7 + x * 1.3);
    p.setXYZ(i, x * j * 1.08, y * j * (y < 0 ? 0.7 : 0.92), z * j);   // flatter underneath so it sits like a real stone
  }
  g.computeVertexNormals();
  return g;
}

/** every tree model; `lod` = cheaper versions (detail-0 puffs, fewer sides) used for chunks far from the camera */
export function treeGeometries(lod = false) {
  const D = lod ? 0 : 1, S = lod ? 5 : 8;
  const cyl = (rt, rb, h, seg = S) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
  const pf = (r) => puff(r, D);
  const leaf = (g, a, b) => tintGrad(g, a, b);
  // --- rounded "cedar" (was spiky cones): stacked soft tiers, widest at the bottom
  const pine = merge([
    at(tint(cyl(0.16, 0.28, 1.6), 0x6b4a2c), 0, 0.8, 0),
    at(leaf(pf(1.0), 0x2f6b3c, 0x3f8a4a), 0, 2.0, 0, 0, 0, 0, 1.45, 0.85, 1.45),
    at(leaf(pf(1.0), 0x347a43, 0x46944f), 0, 3.0, 0, 0, 0.6, 0, 1.15, 0.8, 1.15),
    at(leaf(pf(1.0), 0x3b8a4a, 0x52a45a), 0, 3.9, 0, 0, 1.2, 0, 0.82, 0.75, 0.82),
    at(leaf(pf(1.0), 0x449652, 0x5cb062), 0, 4.6, 0, 0, 0, 0, 0.45, 0.5, 0.45),
  ]);
  // --- oak: chunky trunk with two stubby branches, five clustered puffs
  const oak = merge([
    at(tint(cyl(0.24, 0.4, 2.2), 0x6a4a2c), 0, 1.1, 0),
    at(tint(cyl(0.1, 0.17, 1.2), 0x6a4a2c), 0.42, 2.2, 0.1, 0, 0, -0.75),
    at(tint(cyl(0.1, 0.16, 1.1), 0x6a4a2c), -0.4, 2.25, -0.15, 0.2, 0, 0.7),
    at(leaf(pf(1.45), 0x4a9038, 0x66b44e), 0, 3.0, 0),
    at(leaf(pf(1.05), 0x52a040, 0x6cbc52), 1.0, 2.55, 0.35),
    at(leaf(pf(1.1), 0x438a34, 0x5aa846), -0.95, 2.6, -0.45),
    at(leaf(pf(0.95), 0x5aac46, 0x78c45a), 0.15, 3.9, -0.2),
    at(leaf(pf(0.8), 0x4c9a3c, 0x66b44e), 0.1, 2.7, 1.0),
  ]);
  // --- palm: curved trunk of stacked rings, soft drooping leaf-lobes (two overlapping ellipsoids each) and coconuts
  const palmParts = [];
  for (let i = 0; i < 4; i++) palmParts.push(at(tint(cyl(0.2 - i * 0.02, 0.25 - i * 0.02, 1.0), i % 2 ? 0x9a7b4f : 0xa88a5c), -0.0 + i * 0.07, 0.5 + i * 0.95, 0, 0, 0, -0.07 - i * 0.02));
  const cx = 0.24, cy = 3.75;
  const NF = lod ? 5 : 7;                                         // far palms: fewer fronds, one lobe each, no knot (t256u audit)
  for (let i = 0; i < NF; i++) {
    const a = (i / NF) * Math.PI * 2 + 0.3, col = i % 2 ? 0x3f9b4a : 0x2f8a44;
    const lobes = lod
      ? [at(leaf(puff(1, 0), col, 0x5cb85e), 1.2, 0.12, 0, 0, 0, 0.12, 1.3, 0.09, 0.3)]
      : [at(leaf(puff(1, 0), col, 0x5cb85e), 0.75, 0.15, 0, 0, 0, 0.35, 0.85, 0.09, 0.26),
        at(tint(puff(0.14, 0), col), 1.33, 0.36, 0, 0, 0, 0, 1, 0.7, 1),                       // the bend in the frond, joins the two lobes
        at(leaf(puff(1, 0), col, 0x56b058), 1.87, 0.1, 0, 0, 0, -0.45, 0.75, 0.08, 0.22)];  // droops from the bend
    for (const g of lobes) { at(g, 0, 0, 0, 0, a, 0); at(g, cx, cy, 0); palmParts.push(g); }
  }
  // coconuts are tiny: always detail 0
  if (!lod) palmParts.push(at(tint(puff(0.17, 0), 0x6a4a26), cx + 0.15, cy - 0.15, 0.1), at(tint(puff(0.16, 0), 0x5a3b1e), cx - 0.1, cy - 0.18, 0.14), at(tint(puff(0.16, 0), 0x6a4a26), cx, cy - 0.17, -0.16));
  palmParts.push(at(tint(pf(0.3), 0x3a8a40), cx, cy + 0.05, 0));
  const palm = merge(palmParts);
  const bush = merge([
    at(leaf(pf(0.9), 0x447f32, 0x62a446), 0, 0.55, 0, 0, 0, 0, 1.15, 0.8, 1.15),
    at(leaf(pf(0.65), 0x4f9038, 0x6cb04c), 0.62, 0.42, 0.3, 0, 0, 0, 1, 0.8, 1),
    at(leaf(pf(0.6), 0x3e7530, 0x5a9a42), -0.55, 0.4, -0.3),
    at(leaf(pf(0.5), 0x4a8a36, 0x68aa4a), 0.05, 0.95, 0.15),
  ]);
  // --- Australian eucalypt (gum): tall pale trunk, soft flattened blue-green puffs
  const gum = merge([
    at(tint(cyl(0.2, 0.38, 4.6), 0xdcd5c2), 0, 2.3, 0, 0, 0, 0.05),
    at(tint(cyl(0.12, 0.2, 2.4, S - 2), 0xd2cab6), 0.35, 5.4, 0, 0, 0, -0.55),
    at(tint(cyl(0.1, 0.16, 2.2, S - 2), 0xd2cab6), -0.4, 5.2, 0.2, 0.3, 0, 0.6),
    at(leaf(pf(1.25), 0x5f8d70, 0x7cab8a), 1.4, 6.8, 0, 0, 0, 0, 1.2, 0.62, 1.1),
    at(leaf(pf(1.3), 0x56836a, 0x74a283), -1.2, 6.7, 0.4, 0, 0, 0, 1.2, 0.62, 1.1),
    at(leaf(pf(1.1), 0x679a7a, 0x84b592), 0.1, 7.7, -0.3, 0, 0, 0, 1.1, 0.62, 1.0),
    at(leaf(pf(0.8), 0x5e8e70, 0x7aa886), 0.55, 5.9, 0.55, 0, 0, 0, 1.1, 0.62, 1.0),
  ]);
  // --- paperbark: pale shaggy trunk (a soft dark band), dense rounded crown
  const paperbark = merge([
    at(tint(cyl(0.3, 0.44, 3.0), 0xebe3cf), 0, 1.5, 0),
    at(tint(cyl(0.32, 0.45, 0.6), 0x7a6650), 0, 0.9, 0, 0, 0.5, 0),
    at(leaf(pf(1.6), 0x386f45, 0x4e8f5a), 0, 3.7, 0, 0, 0, 0, 1.2, 0.82, 1.2),
    at(leaf(pf(1.1), 0x437f4f, 0x5a9c66), 1.0, 3.2, 0.5),
    at(leaf(pf(1.0), 0x31683f, 0x4a8656), -0.9, 3.3, -0.4),
  ]);
  // --- mangrove: tangle of rounded prop roots (tapered tubes, blunt ends) under a round crown
  const mangParts = [at(tint(cyl(0.14, 0.2, 1.4, S - 2), 0x4d3b26), 0, 1.3, 0), at(leaf(pf(1.2), 0x2b6437, 0x3f8248), 0, 2.5, 0, 0, 0, 0, 1.2, 0.8, 1.2), at(leaf(pf(0.8), 0x367540, 0x4a8e52), 0.7, 2.2, 0.3)];
  const rootL = Math.hypot(0.9, 1.3), rootT = Math.atan2(0.9, 1.3);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.2;
    const root = at(tint(cyl(0.11, 0.05, rootL, 5), 0x56422b), 0, 0, 0, 0, 0, Math.PI);  // narrow end down
    at(root, 0, rootL / 2, 0);
    at(root, 0, 0, 0, 0, 0, rootT);
    at(root, 0.9, 0, 0);
    at(root, 0, 0, 0, 0, a, 0);
    mangParts.push(root);
  }
  const mangrove = merge(mangParts);
  // --- weeping willow: short trunk, round crown, a curtain of long soft drooping lobes (was sharp downward cones)
  const willParts = [at(tint(cyl(0.25, 0.42, 2.2), 0x5e4a30), 0, 1.1, 0), at(leaf(pf(1.9), 0x7aa246, 0x9cc45e), 0, 3.4, 0, 0, 0, 0, 1.2, 0.8, 1.2)];
  const NW = lod ? 6 : 10;
  for (let i = 0; i < NW; i++) {
    const a = (i / NW) * Math.PI * 2;
    willParts.push(at(leaf(puff(1, 0), i % 2 ? 0x76a046 : 0x8bb454, i % 2 ? 0x8eb85a : 0xa2c86a), Math.cos(a) * 1.9, 2.5, Math.sin(a) * 1.9, 0, 0, 0, 0.42, 1.45, 0.42));
  }
  const willow = merge(willParts);
  // --- Norfolk Island pine: very tall, regular soft tiers (flattened puffs instead of cones)
  const norParts = [at(tint(cyl(0.14, 0.35, 18.4, S - 2), 0x5a4a38), 0, 9.2, 0)];
  for (let i = 0; i < 9; i++) {
    const y = 4 + i * 1.5, r = 2.0 - i * 0.16;
    norParts.push(at(leaf(puff(1, i < 3 ? D : 0), i % 2 ? 0x2a5f39 : 0x25553a, i % 2 ? 0x3c7d4c : 0x356f45), 0, y, 0, 0, i * 0.7, 0, r, 0.42, r));
  }
  norParts.push(at(leaf(pf(1), 0x2f6a40, 0x40854f), 0, 18.0, 0, 0, 0, 0, 0.4, 0.8, 0.4));
  const norfolk = merge(norParts);
  return { pine, oak, palm, bush, gum, paperbark, mangrove, willow, norfolk };
}

/** a soft grass tuft: six wide, bent, round-tipped blades (darker at the base); white-ish so the instance colour tints it */
export function grassGeometry() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + (i % 2) * 0.3, h = 0.62 + ((i * 7) % 5) * 0.08;
    const b = tintGrad(blade(h, 0.17, 0.35 + (i % 3) * 0.08), 0x9a9a9a, 0xffffff, 0, 0.95);
    at(b, 0.04, 0, 0, 0, -a, 0);
    parts.push(b);
  }
  return merge(parts);
}
export function reedGeometry() {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.4 + 0.2;
    parts.push(at(tintGrad(blade(1.5 + (i % 3) * 0.18, 0.09, 0.18), 0x5c8a3e, 0x8cb862), Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06, 0, -a, 0));
  }
  parts.push(at(tint(new THREE.CylinderGeometry(0.015, 0.02, 1.7, 4), 0x6a8a40), 0.05, 0.85, 0.02));
  parts.push(at(tint(new THREE.CapsuleGeometry(0.07, 0.28, 3, 6), 0x6b4a2a), 0.05, 1.72, 0.02));
  return merge(parts);
}

/** a clump of seagrass ribbons (instance-coloured) */
export function seagrassGeometry() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1;
    parts.push(at(tintGrad(blade(1.4 + (i % 3) * 0.3, 0.12, 0.3), 0xaaaaaa, 0xffffff), Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1, 0, -a, 0));
  }
  return merge(parts);
}
/** branching coral: rounded capsule fingers with bulbous tips (white so the instance colour tints it) */
export function coralGeometry() {
  const parts = [at(tint(puff(0.32, 1), 0xdddddd), 0, 0.12, 0, 0, 0, 0, 1, 0.55, 1)];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26, L = 0.8 + (i % 2) * 0.4;
    parts.push(at(tintGrad(new THREE.CapsuleGeometry(0.12, L, 1, 6), 0xcccccc, 0xffffff), Math.cos(a) * 0.3, 0.75, Math.sin(a) * 0.3, Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45));
  }
  return merge(parts);
}
