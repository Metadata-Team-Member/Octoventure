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
  return { pine, oak, palm, bush };
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
