// Low-poly geometry for every prop kind placed by areas.js (all from primitives).
import * as THREE from 'three';
import { tint, merge, at, rbox, puff } from './models.js';
import { bigShell } from './shells.js';

/** every box is bevelled (rounded edges) now - no raw default cubes anywhere (t256u) */
const box = (w, h, d, hex, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, r = Math.min(0.12, Math.min(w, h, d) * 0.3)) => at(tint(rbox(w, h, d, r), hex), x, y, z, rx, ry, rz);
const cyl = (r1, r2, h, hex, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 10) => at(tint(new THREE.CylinderGeometry(r1, r2, h, seg), hex), x, y, z, rx, ry, rz);
const cone = (r, h, hex, x = 0, y = 0, z = 0, seg = 10, rx = 0, ry = 0, rz = 0) => at(tint(new THREE.ConeGeometry(r, h, seg), hex), x, y, z, rx, ry, rz);
const ball = (r, hex, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => at(tint(puff(r, 1), hex), x, y, z, 0, 0, 0, sx, sy, sz);
/** tiny details (window bars, grates): a plain box - a bevel would be invisible at that size and cost 9x the triangles */
const sbox = (w, h, d, hex, x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0) => at(tint(new THREE.BoxGeometry(w, h, d), hex), x, y, z, rx, ry, rz);
const dot = (r, hex, x, y, z, sx = 1, sy = 1, sz = 1) => at(tint(puff(r, 0), hex), x, y, z, 0, 0, 0, sx, sy, sz);
/** a round wooden rail / post (soft tube) */
const rail = (len, r, hex, x, y, z, ry = 0) => at(tint(new THREE.CylinderGeometry(r, r, len, 6), hex), x, y, z, 0, ry, Math.PI / 2);

/** a triangular prism (gable end) of base d, rise R, length w along x, sitting on y = 0 */
function prism(w, d, R, hex) {
  const sh = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, R)]);
  const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2); g.rotateY(Math.PI / 2);
  return tint(g, hex);
}
function windowAt(x, y, z, ry = 0) {
  const parts = [
    box(1.55, 1.55, 0.14, 0xf6f1e6, 0, 0, 0, 0, 0, 0, 0.06), sbox(1.22, 1.22, 0.16, 0x9fd3ee, 0, 0, 0.02),
    sbox(0.08, 1.22, 0.18, 0xf6f1e6, 0, 0, 0.03), sbox(1.22, 0.08, 0.18, 0xf6f1e6, 0, 0, 0.03),
    sbox(1.8, 0.14, 0.36, 0xf6f1e6, 0, -0.84, 0.1),                                     // sill
    sbox(1.5, 0.34, 0.34, 0x8a5a3a, 0, -1.1, 0.16),                                     // window box ...
    dot(0.17, 0xe86a8a, -0.45, -0.88, 0.2), dot(0.16, 0xffd35a, 0, -0.86, 0.2), dot(0.17, 0xb88ae8, 0.45, -0.88, 0.2),   // ... with flowers
  ];
  return parts.map((g) => at(at(g, 0, 0, 0, 0, ry, 0), x, y, z));
}
function house(w, d, h, wall, roof) {
  const R = 2.3, ov = 0.45, half = d / 2 + ov, slope = Math.atan2(R, d / 2), sl = Math.hypot(half, R * half / (d / 2));
  const top = h;                                       // top of the walls
  const parts = [
    box(w, h + 2, d, wall, 0, (h - 2) / 2, 0, 0, 0, 0, 0.3),
    box(w + 0.3, 0.7, d + 0.3, 0xb7aa98, 0, 0.0, 0, 0, 0, 0, 0.15),                       // plinth
    at(prism(w, d, R, wall), 0, top, 0),                                                    // gable ends
    at(tint(rbox(w + 0.9, 0.26, sl, 0.1), roof), 0, top + R / 2 + 0.12, -half / 2 + 0.0, -slope, 0, 0),        // two soft roof slabs (with overhang)
    at(tint(rbox(w + 0.9, 0.26, sl, 0.1), roof), 0, top + R / 2 + 0.12, half / 2 - 0.0, slope, 0, 0),
    rail(w + 1.0, 0.2, roof, 0, top + R + 0.15, 0),                                         // rounded ridge cap
    rail(w + 0.6, 0.11, 0xe8e8ea, 0, top - 0.15, d / 2 + ov - 0.1), rail(w + 0.6, 0.11, 0xe8e8ea, 0, top - 0.15, -d / 2 - ov + 0.1),   // gutters
    cyl(0.07, 0.07, top, 0xe8e8ea, w / 2 - 0.05, top / 2, d / 2 + 0.2, 0, 0, 0, 6),                            // downpipe
    // door with a frame, knob and a front step
    box(1.7, 2.6, 0.14, 0xf6f1e6, 0, 1.3, d / 2 + 0.05), box(1.3, 2.3, 0.2, 0x6b4a33, 0, 1.18, d / 2 + 0.08), dot(0.08, 0xe8c25a, 0.42, 1.15, d / 2 + 0.22),
    box(2.0, 0.28, 0.8, 0xc9c2b4, 0, 0.14, d / 2 + 0.4, 0, 0, 0, 0.1),
    ...windowAt(-w * 0.3, 2.7, d / 2 + 0.05), ...windowAt(w * 0.3, 2.7, d / 2 + 0.05),
    ...windowAt(w / 2 + 0.05, 2.7, 0, Math.PI / 2), ...windowAt(-w / 2 - 0.05, 2.7, 0, -Math.PI / 2),
    // chimney with a cap
    box(0.9, 3.0, 0.9, 0x9a6650, w * 0.25, top + 1.6, -d * 0.18, 0, 0, 0, 0.12), box(1.15, 0.22, 1.15, 0x7a5040, w * 0.25, top + 3.15, -d * 0.18),
  ];
  return merge(parts);
}
/** toy-like car: chunky bevelled body and cabin, fat wheels with hubcaps, round headlights (a subtle friendly face), soft bumpers; +z is forward */
function car() {
  const parts = [
    box(2.0, 0.8, 4.3, 0xffffff, 0, 0.8, 0, 0, 0, 0, 0.34),
    box(1.74, 0.78, 2.3, 0xf4f6f8, 0, 1.52, -0.25, 0, 0, 0, 0.32),
    box(1.5, 0.5, 0.08, 0x2a3640, 0, 1.55, 0.92, 0, -0.35, 0, 0.04), box(1.5, 0.48, 0.08, 0x2a3640, 0, 1.55, -1.42, 0, 0.3, 0, 0.04),   // windscreens
    box(0.08, 0.46, 1.9, 0x2a3640, 0.88, 1.56, -0.25, 0, 0, 0, 0.04), box(0.08, 0.46, 1.9, 0x2a3640, -0.88, 1.56, -0.25, 0, 0, 0, 0.04),
    box(2.1, 0.32, 0.36, 0x4a4f56, 0, 0.5, 2.12, 0, 0, 0, 0.14), box(2.1, 0.32, 0.36, 0x4a4f56, 0, 0.5, -2.12, 0, 0, 0, 0.14),          // bumpers
    dot(0.16, 0xfff6d8, 0.62, 0.92, 2.12, 1, 1, 0.6), dot(0.16, 0xfff6d8, -0.62, 0.92, 2.12, 1, 1, 0.6),                             // headlights (eyes)
    dot(0.13, 0xd84040, 0.68, 0.92, -2.13, 1, 0.8, 0.5), dot(0.13, 0xd84040, -0.68, 0.92, -2.13, 1, 0.8, 0.5),                         // tail lights
  ];
  for (const [sx, z] of [[-1, 1.35], [1, 1.35], [-1, -1.35], [1, -1.35]]) {
    parts.push(cyl(0.44, 0.44, 0.4, 0x1e1e22, sx * 0.98, 0.44, z, 0, 0, Math.PI / 2, 12));
    parts.push(at(tint(puff(0.2, 0), 0xd8dade), sx * 1.18, 0.44, z, 0, 0, 0, 0.4, 1, 1));
  }
  return merge(parts);
}

export const CAR_SCALE = 1.25;
export const PROP_GEO = {
  house0: () => house(9, 8, 4.6, 0xe8d9c2, 0xa14b3a),
  house1: () => house(11, 9, 5.2, 0xc9d6df, 0x5a5f6b),
  house2: () => house(8, 7.5, 4.2, 0xefe6a9, 0x7a4a3a),
  shop: () => merge([
    box(11, 7, 9, 0xd9c7a6, 0, 1.5, 0), box(11.4, 0.5, 9.4, 0x7a7a80, 0, 5.2, 0),
    box(8, 0.35, 1.8, 0xd04a4a, 0, 3.4, 4.9), box(2.2, 2.6, 0.15, 0x9fd3ee, -2.4, 1.5, 4.55), box(2.2, 2.6, 0.15, 0x9fd3ee, 2.4, 1.5, 4.55),
    box(1.1, 0.9, 0.5, 0xb8bcc2, -5.75, 2.9, 0),            // air-con unit on the west wall
  ]),
  barn: () => merge([
    box(14.4, 6.5, 9.4, 0xa6372b, 0, 1.25, 0),
    at(tint(new THREE.ConeGeometry(8.4, 3.2, 4), 0x6c6f75), 0, 6.1, 0, 0, Math.PI / 4, 0, 1.0, 1, 0.66),
    box(4.4, 4.6, 0.2, 0xf1ece0, 0, 2.3, 4.75), box(0.2, 5, 0.2, 0xa6372b, 0, 2.5, 4.9),
  ]),
  silo: () => merge([cyl(3, 3, 11, 0xc7ccd1, 0, 5.5, 0, 0, 0, 0, 12), cone(3.1, 2.2, 0x8f979f, 0, 12.1, 0, 12)]),
  windmill: () => merge([cyl(0.35, 0.8, 11, 0x9aa1a8, 0, 5.5, 0, 0, 0, 0, 6),
    ...[0, 1, 2, 3, 4, 5].map((i) => box(0.25, 3.4, 0.05, 0xe5e8ec, Math.cos(i * 1.05) * 1.8, 11.4 + Math.sin(i * 1.05) * 1.8, 0.5, 0, 0, i * 1.05 + Math.PI / 2))]),
  haybale: () => cyl(0.95, 0.95, 1.4, 0xd2b24a, 0, 0.95, 0, 0, 0, Math.PI / 2, 10),
  fence: () => merge([
    ...[-2.9, 0, 2.9].flatMap((x) => [cyl(0.09, 0.1, 1.5, 0x8a6a46, x, 0.75, 0, 0, 0, 0, 6), ball(0.1, 0x8a6a46, x, 1.5, 0, 1, 0.6, 1)]),
    rail(6, 0.06, 0xa88458, 0, 1.2, 0), rail(6, 0.06, 0xa88458, 0, 0.7, 0), rail(6, 0.06, 0xa88458, 0, 0.25, 0),
  ]),
  fencehole: () => merge([box(1.0, 0.8, 0.22, 0x14110e, 0, 0.4, 0), box(0.2, 0.9, 0.06, 0xa88458, -0.55, 0.45, 0.13, 0, 0, 0.15), box(0.2, 0.7, 0.06, 0xa88458, 0.6, 0.35, -0.13, 0, 0, -0.2)]),
  shed: () => merge([box(3.2, 2.4, 3.2, 0xb9a98a, 0, 1.2, 0), box(3.6, 0.2, 3.6, 0x66707a, 0, 2.5, 0, 0, 0.12), box(0.9, 1.7, 0.1, 0x6b4a33, 0, 0.85, 1.62)]),
  bin: () => merge([box(0.8, 1.0, 0.9, 0x2f7d4a, 0, 0.5, 0), box(0.86, 0.1, 0.96, 0x276540, 0, 1.05, 0.0), cyl(0.12, 0.12, 0.1, 0x222222, -0.3, 0.2, 0.46, Math.PI / 2, 0, 0, 6), cyl(0.12, 0.12, 0.1, 0x222222, 0.3, 0.2, 0.46, Math.PI / 2, 0, 0, 6)]),
  birdbath: () => merge([cyl(0.18, 0.28, 0.9, 0xa8a6a0, 0, 0.45, 0, 0, 0, 0, 7), cyl(0.7, 0.35, 0.22, 0xb8b6b0, 0, 1.0, 0, 0, 0, 0, 9), cyl(0.58, 0.58, 0.04, 0x6cc0ea, 0, 1.1, 0, 0, 0, 0, 9)]),
  bowl: () => merge([cyl(0.42, 0.34, 0.16, 0xd04a4a, 0, 0.08, 0, 0, 0, 0, 9), cyl(0.33, 0.33, 0.02, 0x6cc0ea, 0, 0.15, 0, 0, 0, 0, 9)]),
  trough: () => merge([box(2.8, 0.5, 0.1, 0x8d9399, 0, 0.25, 0.7), box(2.8, 0.5, 0.1, 0x8d9399, 0, 0.25, -0.7), box(0.1, 0.5, 1.5, 0x8d9399, 1.4, 0.25, 0), box(0.1, 0.5, 1.5, 0x8d9399, -1.4, 0.25, 0)]),
  tin: () => merge([cyl(0.36, 0.36, 0.85, 0xc9ced4, 0, 0.36, 0, 0, 0, Math.PI / 2, 10), cyl(0.37, 0.37, 0.05, 0x1b1b1d, 0.43, 0.36, 0, 0, 0, Math.PI / 2, 10), cyl(0.37, 0.37, 0.3, 0xd04a4a, -0.1, 0.36, 0, 0, 0, Math.PI / 2, 10)]),
  shellhide: () => bigShell(),
  slab: () => merge([dot(0.55, 0x77756f, -0.9, 0.3, 0, 1, 0.8, 1), dot(0.5, 0x75736d, 0.9, 0.28, 0.1, 1, 0.8, 1), box(2.8, 0.38, 2.0, 0x8c8a85, 0, 0.78, 0, 0.2)]),
  hollowlog: () => merge([cyl(0.62, 0.62, 3.2, 0x6b4d33, 0, 0.62, 0, 0, 0, Math.PI / 2, 9), cyl(0.38, 0.38, 3.3, 0x1b130d, 0, 0.62, 0, 0, 0, Math.PI / 2, 9)]),
  log: () => merge([cyl(0.36, 0.36, 2.8, 0x7a5d44, 0, 0.3, 0, 0, 0, Math.PI / 2, 10), cyl(0.3, 0.3, 2.84, 0xc9a77a, 0, 0.3, 0, 0, 0, Math.PI / 2, 10)]),   // pale cut ends
  drain: () => merge([box(1.3, 0.08, 0.8, 0x1b1c1f, 0, 0.02, 0), ...[-0.45, -0.15, 0.15, 0.45].map((x) => sbox(0.07, 0.1, 0.8, 0x8a8f95, x, 0.05, 0))]),
  culvert: () => merge([cyl(0.85, 0.85, 1.4, 0xb9b6ae, 0, 0.55, 0, Math.PI / 2, 0, 0, 12), cyl(0.62, 0.62, 1.45, 0x0e0e10, 0, 0.55, 0, Math.PI / 2, 0, 0, 12)]),
  pipe: () => merge([cyl(0.55, 0.55, 1.2, 0x6c7a86, 0, 0.45, 0, Math.PI / 2, 0, 0, 10), cyl(0.4, 0.4, 1.25, 0x0e0e10, 0, 0.45, 0, Math.PI / 2, 0, 0, 10)]),
  plank: () => merge([box(3.0, 0.18, 4.2, 0x8a6a4a, 0, 0, 0), box(3.0, 0.1, 0.12, 0x6b4f35, 0, 0.12, 1.2), box(3.0, 0.1, 0.12, 0x6b4f35, 0, 0.12, -1.2), box(0.12, 0.9, 4.2, 0x6b4f35, 1.5, 0.45, 0), box(0.12, 0.9, 4.2, 0x6b4f35, -1.5, 0.45, 0)]),
  pylon: () => cyl(0.32, 0.4, 4.2, 0x4f3c2a, 0, 2.1, 0, 0, 0, 0, 7),
  hull: () => merge([at(tint(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xffffff), 0, 1.0, 0, Math.PI, 0, 0, 1.0, 0.7, 3.0), box(1.5, 0.12, 4.2, 0x6d4a2e, 0, 0.95, 0)]),
  umbrella: () => merge([cyl(0.04, 0.04, 2.4, 0xcfcfcf, 0, 1.2, 0, 0, 0, 0, 6), cone(1.6, 0.7, 0xffffff, 0, 2.5, 0, 12), ball(0.09, 0xffffff, 0, 2.88, 0)]),
  towel: () => box(1.9, 0.04, 1.0, 0xffffff, 0, 0.03, 0),
  post: () => cyl(0.07, 0.09, 1.1, 0x8a7a5a, 0, 0.55, 0, 0, 0, 0, 5),
  crabpot: () => merge([cyl(0.55, 0.6, 0.55, 0x5a4a38, 0, 0.28, 0, 0, 0, 0, 8), cyl(0.3, 0.55, 0.15, 0x3c3226, 0, 0.6, 0, 0, 0, 0, 8)]),
  shack: () => merge([box(6.4, 3, 5.2, 0x9aa7a0, 0, 1.5, 0), box(7, 0.2, 5.8, 0x8f969c, 0, 3.2, 0, 0, 0.1), box(1.1, 2.0, 0.1, 0x6b4a33, 0, 1.0, 2.62), box(1.4, 1.1, 0.1, 0x9fd3ee, -2, 1.8, 2.62)]),
  lighthouse: () => merge([
    cyl(2.2, 3.3, 8, 0xf4f4f0, 0, 4, 0, 0, 0, 0, 14), cyl(2.0, 2.2, 5, 0xc23b32, 0, 10.5, 0, 0, 0, 0, 14), cyl(1.8, 2.0, 5, 0xf4f4f0, 0, 15.5, 0, 0, 0, 0, 14),
    cyl(1.7, 1.8, 3, 0xc23b32, 0, 19.5, 0, 0, 0, 0, 14), cyl(2.7, 2.7, 0.5, 0x2a2a2e, 0, 21.2, 0, 0, 0, 0, 14), cyl(1.3, 1.3, 1.8, 0xfff2b0, 0, 22.3, 0, 0, 0, 0, 10), cone(1.7, 1.6, 0xc23b32, 0, 23.9, 0, 10)]),
  watertower: () => merge([...[[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]].map(([x, z]) => cyl(0.15, 0.15, 12, 0x8b929a, x, 6, z, 0, 0, 0, 5)), cyl(3.4, 3.4, 4.2, 0xcdd3d8, 0, 14, 0, 0, 0, 0, 12), cone(3.5, 1.6, 0x8b929a, 0, 16.9, 0, 12)]),
  cairn: () => merge([ball(0.6, 0x8a8984, 0, 0.35, 0, 1.2, 0.7, 1.2), ball(0.42, 0x908f89, 0.05, 0.9, 0, 1, 0.7, 1), ball(0.28, 0x95948e, 0, 1.3, 0.03)]),
  lamp: () => merge([cyl(0.08, 0.1, 5, 0x4d5258, 0, 2.5, 0, 0, 0, 0, 6), box(0.6, 0.16, 0.34, 0x4d5258, 0.2, 5.0, 0), box(0.42, 0.06, 0.22, 0xfff0c0, 0.2, 4.9, 0)]),
  parkedcar: car,
};
/** kinds whose instance colour comes from `hue` (HSL) rather than a grey `tint` */
export const HUE_KINDS = new Set(['parkedcar', 'umbrella', 'towel', 'hull']);
/** tall landmarks that stay visible beyond the normal view distance */
export const LANDMARK_KINDS = new Set(['lighthouse', 'windmill', 'watertower']);

/**
 * Real-scale perspective: against a 20 cm octopus these things are far taller than their layouts (lot sizes, car slots, fence runs)
 * were drawn for, so they are stretched *vertically* (footprints are untouched). Cars grow uniformly (slots are sized for that).
 */
const STRETCH = { house0: 1.7, house1: 1.7, house2: 1.7, shop: 1.5, barn: 1.4, shed: 1.7, fence: 2.1, fencehole: 1.0 };
for (const [kind, k] of Object.entries(STRETCH)) {
  const make = PROP_GEO[kind];
  PROP_GEO[kind] = () => { const g = make(); g.scale(1, k, 1); return g; };
}
{
  const make = PROP_GEO.parkedcar;
  PROP_GEO.parkedcar = () => { const g = make(); g.scale(CAR_SCALE, CAR_SCALE, CAR_SCALE); return g; };
}
