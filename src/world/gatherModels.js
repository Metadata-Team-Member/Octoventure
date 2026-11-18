// =====================================================================
//  Gatherable models (t236u): small hand-built shapes in natural colours, baked as vertex colours (non-indexed, so they merge
//  and seat exactly like every other object: see placement.js). 1 u ~ 33 cm, so a pebble is ~4 cm, a crab ~8 cm.
//  Critters (crab, shrimp) also come as separate animated parts (see systems/gather.js); the merged rest pose here is what the
//  placement audit seats.
// =====================================================================
import * as THREE from 'three';
import { tint, merge, at, rockGeometry } from './models.js';

const C = (h) => new THREE.Color(h);
const sph = (r, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs);

/** recolour a geometry per vertex: fn(x, y, z) -> THREE.Color (or hex) */
function paint(geo, fn) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const p = g.attributes.position, c = new Float32Array(p.count * 3), col = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const r = fn(p.getX(i), p.getY(i), p.getZ(i)); col.set(r); c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const mixC = (a, b, t) => C(a).lerp(C(b), Math.min(1, Math.max(0, t)));
/** a bowl (half sphere, opening upward) with an outer and an inner skin so both sides have their own colour */
function bowl(r, sy, outer, inner, rim) {
  const out = paint(new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), (x, y, z) => mixC(outer, rim, Math.atan2(z, x) % 0.7 < 0.18 ? 0.35 : 0));
  out.scale(1, sy, 1);
  const inn = paint(new THREE.SphereGeometry(r * 0.9, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), () => inner);
  inn.scale(1, sy * 0.9, 1); inn.translate(0, sy * r * 0.1, 0);
  const lip = tint(new THREE.TorusGeometry(r * 0.95, r * 0.05, 4, 14), rim); lip.rotateX(Math.PI / 2); lip.translate(0, 0.002, 0);
  const m = merge([out, inn, lip]); m.computeBoundingBox(); m.translate(0, -m.boundingBox.min.y, 0);   // sits on its rim
  return m;
}
/** a ribbon (fronds, blades): a strip following a curve, width tapering to the tip */
function ribbon(h, w0, bend, seed, c0, c1, seg = 7) {
  const pos = [], col = [], idx = [];
  const a = C(c0), b = C(c1), cc = new THREE.Color();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, y = h * t, x = Math.sin(t * 3 + seed) * bend * t, z = Math.cos(t * 2.2 + seed * 1.7) * bend * 0.5 * t, w = w0 * (1 - 0.75 * t) * (1 + 0.25 * Math.sin(t * 9 + seed));
    for (const s of [-1, 1]) { pos.push(x + s * w, y, z); cc.copy(a).lerp(b, t); col.push(cc.r, cc.g, cc.b); }
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  const n = g.toNonIndexed(); n.computeVertexNormals(); return n;
}

// ---------------------------------------------------------------- the individual models (origin at the base, +y up, facing +z)
export const pebble = () => merge([
  at(paint(rockGeometry(1), (x, y, z) => mixC(0xb9b3a8, 0xe3ddd0, (y + 1) * 0.35 + Math.abs(Math.sin(x * 5)) * 0.1)), 0, 0.05, 0, 0, 0.5, 0, 0.14, 0.085, 0.1),
  at(paint(rockGeometry(1), (x, y) => mixC(0x8f8a82, 0xc9c3b6, (y + 1) * 0.4)), 0.17, 0.035, 0.07, 0, 1.2, 0, 0.09, 0.06, 0.075),
]);
export const mussel = () => merge([
  at(paint(sph(1, 8, 6), (x, y, z) => mixC(0x1f2a44, 0x56638a, Math.abs(Math.sin(z * 9)) * 0.45 + y * 0.1)), 0, 0.06, 0, 0, 0.2, 0, 0.085, 0.065, 0.17),
  at(paint(sph(1, 8, 6), (x, y, z) => mixC(0x232f4c, 0x5d6a92, Math.abs(Math.sin(z * 9)) * 0.45)), 0.11, 0.055, 0.03, 0, -0.35, 0, 0.075, 0.058, 0.15),
  at(paint(sph(1, 8, 6), (x, y, z) => mixC(0x1c2640, 0x4e5b80, Math.abs(Math.sin(z * 9)) * 0.4)), -0.1, 0.05, 0.05, 0, 0.7, 0, 0.07, 0.055, 0.14),
]);
export const snail = () => {
  const spiral = paint(sph(1, 12, 8), (x, y, z) => { const a = Math.atan2(z, x) + y * 3.2; return mixC(0x8a5a32, 0xe0c58f, Math.sin(a * 4) * 0.5 + 0.5); });
  return merge([
    at(paint(sph(1, 8, 6), (x, y) => mixC(0xb9ad93, 0xd8cfb7, y)), 0, 0.035, 0.05, 0, 0, 0, 0.055, 0.04, 0.17),
    at(spiral, 0, 0.11, -0.04, 0, 0, 0, 0.1, 0.1, 0.1),
    at(tint(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 4), 0xb9ad93), -0.025, 0.1, 0.2, 0.3, 0, 0.2),
    at(tint(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 4), 0xb9ad93), 0.025, 0.1, 0.2, 0.3, 0, -0.2),
  ]);
};
export const kelp = () => {
  const parts = [at(tint(sph(0.09, 6, 4), 0x4a4224), 0, 0.03, 0, 0, 0, 0, 1, 0.5, 1)];
  for (let i = 0; i < 4; i++) { const g = ribbon(1.1 + i * 0.12, 0.085, 0.16, i * 1.9, 0x4f4a1f, 0x8d8a34); g.rotateY(i * 1.57 + 0.4); parts.push(g); }
  return merge(parts);
};
export const lettuce = () => {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26, g = paint(sph(1, 8, 4), (x, y, z) => mixC(0x5fb046, 0xa6e06a, (Math.sin(Math.atan2(z, x) * 7) * 0.5 + 0.5) * 0.7 + y * 0.3));
    parts.push(at(g, Math.cos(a) * 0.11, 0.035 + (i % 2) * 0.02, Math.sin(a) * 0.11, Math.sin(a) * 0.35, a, Math.cos(a) * 0.3, 0.17, 0.022, 0.13));
  }
  parts.push(at(paint(sph(1, 8, 4), () => 0x7fcb55), 0, 0.03, 0, 0, 0, 0, 0.16, 0.025, 0.14));
  return merge(parts);
};
export const sponge = () => {
  const parts = [];
  [[0, 0, 0.3, 0.08], [0.13, 0.05, 0.22, 0.065], [-0.1, 0.09, 0.26, 0.07]].forEach(([x, z, h, r], i) => {
    parts.push(at(paint(new THREE.CylinderGeometry(r * 0.85, r, h, 8, 1, true), (px, py) => mixC(0xd9822b, 0xf2bd4a, (py / h + 0.5) * 0.8 + Math.abs(Math.sin(px * 90)) * 0.1)), x, h / 2, z));
    parts.push(at(tint(new THREE.CircleGeometry(r * 0.72, 8), 0x8a4a1c), x, h - 0.005, z, -Math.PI / 2));
  });
  return merge(parts);
};
export const coralBit = () => {
  const parts = [at(tint(new THREE.CylinderGeometry(0.06, 0.08, 0.06, 6), 0xe9d6c6), 0, 0.03, 0)];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26;
    parts.push(at(paint(new THREE.ConeGeometry(0.045, 0.3 + (i % 2) * 0.1, 5), (x, y) => mixC(0xff7f86, 0xffc2b5, y * 3 + 0.5)), Math.cos(a) * 0.07, 0.2, Math.sin(a) * 0.07, Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45));
  }
  return merge(parts);
};
export const shellhalf = () => bowl(0.2, 0.55, 0xf0dcc8, 0xf6b8b0, 0xd9b99b);
export const coconut = () => bowl(0.24, 0.8, 0x6a4527, 0xf3ecdc, 0xefe3cb);
export const moss = () => {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const a = i * 0.9, r = i === 0 ? 0 : 0.1 + (i % 3) * 0.04;
    parts.push(at(paint(sph(1, 7, 5), (x, y) => mixC(0x3f7a2c, 0x7ab84e, y * 0.6 + 0.4)), Math.cos(a) * r, 0.04, Math.sin(a) * r, 0, 0, 0, 0.085 + (i % 2) * 0.03, 0.06, 0.085 + (i % 2) * 0.03));
  }
  for (let i = 0; i < 5; i++) { const a = i * 1.7 + 0.4, r = 0.04 + (i % 3) * 0.045; parts.push(at(tint(sph(0.014, 5, 4), 0xe4f7ff), Math.cos(a) * r, 0.098, Math.sin(a) * r)); }   // dew drops
  return merge(parts);
};
export const cap = () => merge([
  at(tint(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 14), 0xc9372c), 0, 0.012, 0),
  at(tint(new THREE.TorusGeometry(0.075, 0.009, 4, 14), 0xd9d3c4), 0, 0.022, 0, Math.PI / 2),
  at(tint(new THREE.CylinderGeometry(0.045, 0.045, 0.004, 10), 0xf1c94a), 0, 0.023, 0),
]);
export const jar = () => {                      // lying on its side (axis along x), open mouth with a gold ring
  const r = 0.17, L = 0.42;
  const body = paint(new THREE.CylinderGeometry(r, r, L, 12, 1, true), () => 0xcfeceb);
  body.rotateZ(Math.PI / 2); body.translate(0, r, 0);
  const base = paint(new THREE.CircleGeometry(r, 12), () => 0xbfe0df); base.rotateY(-Math.PI / 2); base.translate(-L / 2, r, 0);
  const neck = tint(new THREE.TorusGeometry(r * 0.8, 0.018, 4, 12), 0xd5a12b); neck.rotateY(Math.PI / 2); neck.translate(L / 2, r, 0);
  const label = paint(new THREE.CylinderGeometry(r * 1.01, r * 1.01, L * 0.35, 12, 1, true, 0, 3.4), () => 0xf1e6c8); label.rotateZ(Math.PI / 2); label.translate(0, r, 0);
  return merge([body, base, neck, label]);
};

// ---------------------------------------------------------------- critters: separate parts so they can be animated
export const CRAB = {
  body: () => at(paint(sph(1, 10, 6), (x, y, z) => mixC(0xb5472f, 0xe08a55, y * 0.6 + 0.3 + Math.abs(Math.sin(x * 12)) * 0.08)), 0, 0, 0, 0, 0, 0, 0.14, 0.07, 0.1),
  eye: () => merge([at(tint(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 4), 0xc65a3a), 0, 0.025, 0), at(tint(sph(0.016, 5, 4), 0x151010), 0, 0.055, 0)]),
  claw: () => merge([at(tint(new THREE.CylinderGeometry(0.014, 0.018, 0.1, 5), 0xc65a3a), 0, 0, 0.05, Math.PI / 2, 0, 0), at(paint(sph(1, 7, 5), (x, y) => mixC(0xcf5c3a, 0xf0a070, y * 0.5 + 0.4)), 0, 0, 0.13, 0, 0, 0, 0.045, 0.028, 0.06)]),
  leg: () => merge([at(tint(new THREE.CylinderGeometry(0.008, 0.011, 0.11, 4), 0xa63e2a), 0.055, 0, 0, 0, 0, Math.PI / 2 - 0.4), at(tint(new THREE.CylinderGeometry(0.006, 0.008, 0.09, 4), 0x8f3424), 0.12, -0.03, 0, 0, 0, 0.5)]),
};
export const crab = () => merge([
  CRAB.body().translate(0, 0.075, 0),
  CRAB.eye().translate(-0.04, 0.095, 0.07), CRAB.eye().translate(0.04, 0.095, 0.07),
  at(CRAB.claw(), -0.1, 0.075, 0.05, 0, 0.5, 0), at(CRAB.claw(), 0.1, 0.075, 0.05, 0, -0.5, 0),
  ...[-1, 1].flatMap((s) => [0, 1, 2].map((i) => at(CRAB.leg(), s * 0.07, 0.075, -0.045 + i * 0.045, 0, s < 0 ? Math.PI : 0, 0))),
]);
export const SHRIMP = {
  seg: (r, len, c0) => at(paint(sph(1, 7, 5), (x, y) => mixC(c0, 0xffd8c8, y * 0.5 + 0.3)), 0, 0, 0, 0, 0, 0, r, r * 0.9, len),
  tail: () => at(tint(new THREE.ConeGeometry(0.05, 0.08, 4), 0xf09a82), 0, 0, -0.04, -Math.PI / 2, 0, 0, 1, 1, 0.5),
  feeler: () => at(tint(new THREE.CylinderGeometry(0.003, 0.005, 0.3, 3), 0xe8b7a4), 0, 0, 0.15, Math.PI / 2, 0, 0),
};
export const shrimp = () => merge([
  at(SHRIMP.seg(0.04, 0.06, 0xf0a08a), 0, 0.05, 0.12), at(SHRIMP.seg(0.037, 0.055, 0xe9917a), 0, 0.055, 0.06), at(SHRIMP.seg(0.033, 0.05, 0xee9d86), 0, 0.045, 0.005),
  at(SHRIMP.seg(0.028, 0.045, 0xe8927c), 0, 0.03, -0.05), at(SHRIMP.tail(), 0, 0.02, -0.1),
  at(tint(sph(0.012, 5, 4), 0x151010), -0.025, 0.07, 0.18), at(tint(sph(0.012, 5, 4), 0x151010), 0.025, 0.07, 0.18),
  at(SHRIMP.feeler(), -0.02, 0.07, 0.17, 0, 0.12, 0), at(SHRIMP.feeler(), 0.02, 0.07, 0.17, 0, -0.12, 0),
]);

// ---------------------------------------------------------------- biome-specific finds (t239u)
export const urchin = () => {
  const parts = [at(paint(sph(1, 9, 7), (x, y) => mixC(0x3a2458, 0x7a58a8, y * 0.5 + 0.5)), 0, 0.07, 0, 0, 0, 0, 0.07, 0.06, 0.07)];
  const N = 22, up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {                                                     // spines on a Fibonacci sphere, none pointing into the ground
    const yy = 1 - (i + 0.5) / N * 1.7, r = Math.sqrt(1 - yy * yy), a = i * 2.39996;
    const d = new THREE.Vector3(Math.cos(a) * r, yy, Math.sin(a) * r);
    const g = paint(new THREE.ConeGeometry(0.0075, 0.1, 4), (x, y) => mixC(0x4a3070, 0xb89ee0, y * 6 + 0.4));
    g.translate(0, 0.05, 0);
    q.setFromUnitVectors(up, d); m.compose(new THREE.Vector3(d.x * 0.055, 0.07 + d.y * 0.05, d.z * 0.055), q, new THREE.Vector3(1, 1, 1));
    parts.push(g.applyMatrix4(m));
  }
  return merge(parts);
};
export const worm = () => {
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 9 }, (_, i) => new THREE.Vector3(-0.15 + i * 0.0375, 0.014, Math.sin(i * 1.5) * 0.04)));
  const tube = paint(new THREE.TubeGeometry(curve, 28, 0.014, 6, false), (x) => (x > -0.02 && x < 0.04 ? 0xf0b0a4 : mixC(0xc4706a, 0xdb8f86, (x + 0.15) * 3)));
  return merge([tube, at(paint(sph(1, 6, 4), () => 0xe0968c), 0.152, 0.014, 0.0, 0, 0, 0, 0.018, 0.013, 0.013)]);
};
export const beetle = () => {
  const parts = [
    at(paint(sph(1, 10, 7), (x, y, z) => mixC(0x1f6a52, 0x7ee0b6, y * 0.7 + 0.2 + Math.abs(z) * 0.05)), 0, 0.045, -0.01, 0, 0, 0, 0.055, 0.04, 0.085),
    at(tint(sph(1, 7, 5), 0x15302a), 0, 0.04, 0.085, 0, 0, 0, 0.032, 0.026, 0.028),
    at(tint(new THREE.BoxGeometry(0.004, 0.003, 0.15), 0x103a2c), 0, 0.083, -0.01),
  ];
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) parts.push(at(tint(new THREE.CylinderGeometry(0.004, 0.004, 0.07, 3), 0x15302a), sx * 0.05, 0.022, -0.045 + i * 0.045, 0, 0, sx * (Math.PI / 2 - 0.6)));
  for (const sx of [-1, 1]) parts.push(at(tint(new THREE.CylinderGeometry(0.0025, 0.0025, 0.06, 3), 0x15302a), sx * 0.02, 0.06, 0.12, Math.PI / 2 - 0.3, 0, sx * 0.4));
  return merge(parts);
};
export const spawn = () => {
  const parts = [], pts = [[0, 0], [0.05, 0.01], [-0.045, 0.02], [0.02, -0.05], [-0.02, 0.05], [0.07, -0.035], [-0.07, -0.02], [0.0, 0.0, 1], [0.03, 0.02, 1], [-0.03, -0.02, 1], [0.01, -0.03, 1]];
  pts.forEach(([x, z, up], i) => {
    const y = up ? 0.07 : 0.028;
    parts.push(at(paint(sph(1, 7, 5), (px, py) => mixC(0xb8e0d0, 0xe8fff4, py * 0.5 + 0.5)), x, y, z, 0, 0, 0, 0.03, 0.027, 0.03));
    parts.push(at(tint(sph(1, 5, 4), 0x23302a), x, y, z, 0, 0, 0, 0.011, 0.011, 0.011));
  });
  return merge(parts);
};
export const propagule = () => merge([
  at(paint(sph(1, 9, 6), (x, y) => mixC(0x6e8a30, 0xb8cc60, x * 3 + 0.5 + y * 0.2)), 0, 0.03, 0, 0, 0, 0, 0.16, 0.03, 0.03),
  at(tint(new THREE.ConeGeometry(0.014, 0.05, 6), 0x9bb34a), 0.185, 0.03, 0, 0, 0, -Math.PI / 2),
  at(paint(sph(1, 7, 5), (x, y) => mixC(0x7a5a2c, 0xa88650, y * 0.5 + 0.5)), -0.15, 0.03, 0, 0, 0, 0, 0.04, 0.034, 0.034),
]);

/** t241u: a lump of red ochre (desert) */
export const ochre = () => merge([
  at(paint(rockGeometry(2), (x, y) => mixC(0x8e3a1e, 0xd0683a, (y + 1) * 0.45)), 0, 0.05, 0, 0, 0.3, 0, 0.12, 0.08, 0.1),
  at(paint(rockGeometry(3), (x, y) => mixC(0xa0482a, 0xe08a50, (y + 1) * 0.4)), 0.12, 0.03, 0.05, 0, 1.1, 0, 0.06, 0.045, 0.055),
]);
/** t241u: a little cluster of pale ghost fungi (rainforest; they glow faintly) */
export const fungi = () => {
  const parts = [];
  [[0, 0, 1], [0.07, 0.03, 0.8], [-0.06, 0.04, 0.7], [0.02, -0.07, 0.6]].forEach(([x, z, k]) => {
    parts.push(at(tint(new THREE.CylinderGeometry(0.012 * k, 0.016 * k, 0.09 * k, 6), 0xe8efe0), x, 0.045 * k, z));
    parts.push(at(paint(sph(1, 9, 5), (px, py) => mixC(0xcfe9c0, 0xf4fff0, py * 0.5 + 0.5)), x, 0.09 * k, z, 0, 0, 0, 0.055 * k, 0.025 * k, 0.055 * k));
  });
  return merge(parts);
};

/** a soft reef flower: a squat foot and a few rounded tentacles */
export const anemone = () => {
  const parts = [at(tint(new THREE.CylinderGeometry(0.07, 0.09, 0.045, 7), 0x5c3068), 0, 0.022, 0)];
  for (let i = 0; i < 6; i++) {
    const a = i * (Math.PI * 2 / 6);
    parts.push(at(paint(sph(1, 5, 4), (x, y) => mixC(0xc45a9a, 0xf4c0dc, y * 0.55 + 0.35)), Math.cos(a) * 0.045, 0.13, Math.sin(a) * 0.045, Math.sin(a) * 0.25, a, 0, 0.018, 0.11, 0.018));
  }
  parts.push(at(paint(sph(1, 6, 4), () => 0xe07ab8), 0, 0.07, 0, 0, 0, 0, 0.04, 0.03, 0.04));
  return merge(parts);
};

export const GATHER_MODELS = { crab, shrimp, snail, mussel, kelp, lettuce, sponge, coral: coralBit, shellhalf, pebble, moss, coconut, cap, jar, urchin, worm, beetle, spawn, propagule, ochre, fungi, anemone };
export function buildGatherGeos() { const o = {}; for (const k in GATHER_MODELS) o[k] = GATHER_MODELS[k](); return o; }
/** how each kind sits: tilt to the slope (0..1) */
export const GATHER_TILT = { crab: 0.5, shrimp: 0.3, snail: 0.6, mussel: 0.8, kelp: 0, lettuce: 0.7, sponge: 0.2, coral: 0.2, shellhalf: 1, pebble: 1, moss: 0.6, coconut: 1, cap: 1, jar: 0.8, urchin: 0.6, worm: 0.9, beetle: 0.5, spawn: 0.7, propagule: 1, ochre: 1, fungi: 0.5, anemone: 0.25 };
