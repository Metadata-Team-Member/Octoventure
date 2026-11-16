// Small low-poly model helpers (all built from primitives - no asset files needed).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
export function merge(list) { return mergeGeometries(list, false); }

const M = new THREE.Matrix4();
export function at(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  M.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return geo.applyMatrix4(M);
}

/** jitter an icosahedron so every rock looks a bit different (but is deterministic) */
export function rockGeometry(detail = 0) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let j = seen.get(key);
    if (!j) { j = 0.78 + ((Math.sin(i * 12.9898 + p.getX(i) * 78.233 + p.getZ(i) * 3.1) * 43758.5453) % 1 + 1) % 1 * 0.4; seen.set(key, j); }
    p.setXYZ(i, p.getX(i) * j, p.getY(i) * j, p.getZ(i) * j);
  }
  g.computeVertexNormals();
  return g;
}

export function treeGeometries() {
  const cyl = (rt, rb, h, seg = 6) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const cone = (r, h, seg = 7) => new THREE.ConeGeometry(r, h, seg);
  const ico = (r) => new THREE.IcosahedronGeometry(r, 0);
  const pine = merge([
    at(tint(cyl(0.16, 0.26, 1.4), 0x5b4026), 0, 0.7, 0),
    at(tint(cone(1.45, 2.1), 0x2f6b3c), 0, 2.0, 0),
    at(tint(cone(1.15, 1.9), 0x347a43), 0, 3.1, 0),
    at(tint(cone(0.8, 1.6), 0x3b8a4a), 0, 4.1, 0),
  ]);
  const oak = merge([
    at(tint(cyl(0.22, 0.34, 2.0), 0x6a4a2c), 0, 1.0, 0),
    at(tint(ico(1.5), 0x4f9a3f), 0, 2.9, 0),
    at(tint(ico(1.05), 0x5aa844), 0.9, 2.4, 0.3),
    at(tint(ico(1.15), 0x468c38), -0.8, 2.5, -0.45),
    at(tint(ico(0.9), 0x62b04c), 0.1, 3.7, -0.2),
  ]);
  const palmParts = [at(tint(cyl(0.14, 0.24, 3.6), 0x9a7b4f), 0, 1.8, 0, 0, 0, 0.12)];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const frond = at(tint(new THREE.ConeGeometry(0.28, 2.6, 4), i % 2 ? 0x3f9b4a : 0x2f8a44), 0, 0, 0, 0, 0, Math.PI / 2 + 0.5);
    at(frond, 1.3, 0, 0);
    at(frond, 0, 0, 0, 0, a, 0);
    at(frond, 0.42, 3.65, 0);
    palmParts.push(frond);
  }
  palmParts.push(at(tint(ico(0.22), 0x5a3b1e), 0.3, 3.5, 0.1));
  const palm = merge(palmParts);
  const bush = merge([
    at(tint(ico(0.9), 0x4f8f3a), 0, 0.55, 0, 0, 0, 0, 1.15, 0.8, 1.15),
    at(tint(ico(0.65), 0x5b9f43), 0.6, 0.4, 0.3, 0, 0, 0, 1, 0.8, 1),
    at(tint(ico(0.6), 0x467f34), -0.5, 0.4, -0.3),
  ]);
  // --- Australian eucalypt (gum): tall pale trunk, sparse drooping blue-green foliage
  const gum = merge([
    at(tint(cyl(0.2, 0.36, 4.6, 6), 0xd9d2bf), 0, 2.3, 0, 0, 0, 0.05),
    at(tint(cyl(0.12, 0.2, 2.4, 5), 0xcfc7b3), 0.35, 5.4, 0, 0, 0, -0.55),
    at(tint(cyl(0.1, 0.16, 2.2, 5), 0xcfc7b3), -0.4, 5.2, 0.2, 0.3, 0, 0.6),
    at(tint(ico(1.25), 0x6d9a7b), 1.4, 6.8, 0, 0, 0, 0, 1.2, 0.6, 1.1),
    at(tint(ico(1.3), 0x5f8d70), -1.2, 6.7, 0.4, 0, 0, 0, 1.2, 0.6, 1.1),
    at(tint(ico(1.1), 0x74a283), 0.1, 7.7, -0.3, 0, 0, 0, 1.1, 0.6, 1.0),
    at(tint(ico(0.8), 0x6a9778), 0.6, 5.9, 1.1, 0, 0, 0, 1.1, 0.6, 1.0),
  ]);
  // --- paperbark: pale shaggy trunk, dense dark crown
  const paperbark = merge([
    at(tint(cyl(0.3, 0.42, 3.0, 6), 0xe8e0cc), 0, 1.5, 0),
    at(tint(cyl(0.31, 0.43, 0.6, 6), 0x6b5a45), 0, 0.9, 0, 0, 0.5, 0),
    at(tint(ico(1.6), 0x3f7a4c), 0, 3.7, 0, 0, 0, 0, 1.2, 0.8, 1.2),
    at(tint(ico(1.1), 0x4a8a56), 1.0, 3.2, 0.5),
    at(tint(ico(1.0), 0x376f45), -0.9, 3.3, -0.4),
  ]);
  // --- mangrove: tangle of prop roots under a round crown
  const mangParts = [at(tint(cyl(0.14, 0.2, 1.4, 5), 0x4d3b26), 0, 1.3, 0), at(tint(ico(1.2), 0x2f6b3b), 0, 2.5, 0, 0, 0, 0, 1.2, 0.8, 1.2), at(tint(ico(0.8), 0x3c7d46), 0.7, 2.2, 0.3)];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const root = at(tint(cone(0.1, 1.5, 4), 0x56422b), 0, 0, 0, 0, 0, Math.PI);
    at(root, 0, 0.75, 0, 0, 0, 0);
    at(root, 0, 0, 0, 0.5, a, 0);
    at(root, Math.cos(a) * 0.3, 0.55, Math.sin(a) * 0.3);
    mangParts.push(root);
  }
  const mangrove = merge(mangParts);
  // --- weeping willow: short trunk, huge drooping curtain
  const willParts = [at(tint(cyl(0.25, 0.4, 2.2, 6), 0x5e4a30), 0, 1.1, 0), at(tint(ico(1.9), 0x86ad4c), 0, 3.4, 0, 0, 0, 0, 1.2, 0.8, 1.2)];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const c = at(tint(cone(0.45, 2.8, 4), i % 2 ? 0x7da64a : 0x93b957), 0, 0, 0, 0, 0, Math.PI);
    at(c, Math.cos(a) * 1.9, 2.4, Math.sin(a) * 1.9);
    willParts.push(c);
  }
  const willow = merge(willParts);
  // --- Norfolk Island pine: very tall, regular tiers (the classic coastal landmark)
  const norParts = [at(tint(cyl(0.2, 0.35, 15, 6), 0x5a4a38), 0, 7.5, 0)];
  for (let i = 0; i < 9; i++) {
    const y = 4 + i * 1.5, r = 2.0 - i * 0.16;
    norParts.push(at(tint(cone(r, 1.6, 7), i % 2 ? 0x2f6a40 : 0x2a5f39), 0, y, 0));
  }
  norParts.push(at(tint(cone(0.4, 1.6, 6), 0x2f6a40), 0, 18.2, 0));
  const norfolk = merge(norParts);
  return { pine, oak, palm, bush, gum, paperbark, mangrove, willow, norfolk };
}

export function grassGeometry() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const blade = at(tint(new THREE.ConeGeometry(0.1, 0.95, 3), 0xffffff), Math.cos(a) * 0.14, 0.46, Math.sin(a) * 0.14, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
    parts.push(blade);
  }
  return merge(parts);
}
export function reedGeometry() {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    parts.push(at(tint(new THREE.ConeGeometry(0.06, 1.8, 3), 0x7aa650), Math.cos(a) * 0.2, 0.9, Math.sin(a) * 0.2, Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12));
  }
  parts.push(at(tint(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 5), 0x6b4a2a), 0.05, 1.7, 0.02));
  return merge(parts);
}

/** a clump of seagrass blades (instance-coloured) */
export function seagrassGeometry() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const a = i * 1.1;
    parts.push(at(tint(new THREE.ConeGeometry(0.07, 1.4 + (i % 3) * 0.3, 3), 0xffffff), Math.cos(a) * 0.22, 0.7, Math.sin(a) * 0.22, Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2));
  }
  return merge(parts);
}
/** branching coral (white so the instance colour tints it) */
export function coralGeometry() {
  const parts = [at(tint(new THREE.CylinderGeometry(0.25, 0.35, 0.3, 6), 0xffffff), 0, 0.15, 0)];
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26;
    parts.push(at(tint(new THREE.ConeGeometry(0.17, 1.0 + (i % 2) * 0.4, 5), 0xffffff), Math.cos(a) * 0.3, 0.8, Math.sin(a) * 0.3, Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45));
  }
  return merge(parts);
}
