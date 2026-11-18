// =====================================================================
//  Placement - the ONE place that decides where an object's base sits on the ground.
//  The renderer (worldView / collect) and the placement audit (scripts/placement.mjs) both call these functions, so the
//  audit checks what is really drawn.
//
//  Rules
//   * the terrain the player sees IS world.heightAt (exact triangle interpolation of the drawn mesh, see WorldData.freezeTerrain)
//   * an object is seated by its LOWEST contact points ("probes": the bottom vertices of its geometry, after scale, yaw and
//     slope tilt): the lowest probe touches the ground, the others sink into the slope -> there is never a gap under it
//   * small things (rocks, shells, tins, logs ...) tilt to the slope; trees, posts, fences and buildings stay upright
//   * most things are sunk a little (rocks ~20% embedded, trees' roots) so they look planted rather than placed
//   * flat decals (water, dew) sit at the lowest point of their rim so no edge floats
// =====================================================================
import * as THREE from 'three';
import { GATHER_TILT } from './gatherModels.js';

/** 1 cm at octopus scale (octopus ~1.5 u ~ 20 cm): the largest gap allowed under any object */
export const TOL = 0.0315;     // 1 cm at octopus scale: the octopus is ~20 cm = 0.63 u (CONFIG.octopus.size * 1.5 u model)

const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _v = new THREE.Vector3(), _n = { x: 0, y: 1, z: 0 }, _ax = new THREE.Vector3(), _p = new THREE.Vector3(), _sc = new THREE.Vector3();

const probeCache = new WeakMap();
/** lowest contact points of a geometry (<= 17 of them: the centre + the farthest bottom vertex in each of 16 directions) */
export function probesOf(geo) {
  let c = probeCache.get(geo); if (c) return c;
  geo.computeBoundingBox();
  const bb = geo.boundingBox, h = bb.max.y - bb.min.y, pos = geo.attributes.position, band = bb.min.y + Math.max(0.02, h * 0.06);
  const low = []; let cx = 0, cz = 0;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) <= band) { low.push([pos.getX(i), pos.getY(i), pos.getZ(i)]); cx += pos.getX(i); cz += pos.getZ(i); }
  cx /= low.length || 1; cz /= low.length || 1;
  const best = new Array(16).fill(null);
  for (const p of low) {
    const a = Math.atan2(p[2] - cz, p[0] - cx), s = Math.min(15, Math.floor(((a + Math.PI) / (Math.PI * 2)) * 16));
    const d = Math.hypot(p[0] - cx, p[2] - cz);
    if (!best[s] || d > best[s].d) best[s] = { d, p };
  }
  const pts = best.filter(Boolean).map((b) => b.p);
  const minY = bb.min.y;
  pts.push([cx, minY, cz]);
  c = { pts, h, minY, radius: Math.max(...low.map((p) => Math.hypot(p[0] - cx, p[2] - cz)), 0) };
  probeCache.set(geo, c); return c;
}

/** lowest ground height under a ring (+ centre) of radius r: where flat things (water, dew, bases) must sit to leave no gap */
export function ringMin(world, x, z, r, n = 12) {
  let m = world.heightAt(x, z);
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; const h = world.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r); if (h < m) m = h; }
  return m;
}

/** small things that lie on the ground tilt to the slope */
const THIN = new Set(['towel', 'plank', 'drain']);      // flat things stay flush instead of sinking in
const TILT_PROPS = new Set(['fence', 'wall', 'trough', 'tin', 'shellhide', 'bowl', 'slab', 'log', 'hollowlog', 'towel', 'cairn', 'crabpot', 'haybale', 'plank', 'drain', 'hull', 'fencehole']);

/**
 * What to draw for one spawned object: yaw, scale, tilt (0..1 follows the slope), bury (units sunk below contact), and
 * optionally a fixed y (jetty pylons stand in the water, so they do not follow the ground).
 */
export function instanceSpec(cat, sub, o, geoH = 1) {
  switch (cat) {
    case 'tree': return { x: o.x, z: o.z, rot: o.rot, sx: o.scale, sy: o.scale, sz: o.scale, tilt: 0, bury: 0.08 * o.scale };
    case 'rock': { const h = geoH * o.size * o.sy; return { x: o.x, z: o.z, rot: o.rot, sx: o.size, sy: o.size * o.sy, sz: o.size, tilt: 0.8, bury: 0.2 * h }; }
    case 'grass': return { x: o.x, z: o.z, rot: o.rot, sx: o.s, sy: o.s, sz: o.s, tilt: 0, bury: 0.04 * o.s };
    case 'flower': return { x: o.x, z: o.z, rot: o.rot ?? 0, sx: o.s, sy: o.s, sz: o.s, tilt: 0, bury: 0.02 };
    case 'reed': return { x: o.x, z: o.z, rot: o.rot, sx: o.s, sy: o.s, sz: o.s, tilt: 0, bury: 0.04 };
    case 'beach':
      if (sub === 'shell') return { x: o.x, z: o.z, rot: o.rot, sx: o.s, sy: o.s, sz: o.s, tilt: 1, bury: 0.01 };
      if (sub === 'weed') return { x: o.x, z: o.z, rot: o.rot, sx: o.s * 1.4, sy: o.s * 0.3, sz: o.s, tilt: 0.7, bury: 0.01 };
      return { x: o.x, z: o.z, rot: o.rot, sx: o.s * 1.3, sy: o.s * 1.3, sz: o.s * 1.3, tilt: 0.8, bury: 0.02 };
    case 'seagrass': return { x: o.x, z: o.z, rot: o.rot, sx: o.s, sy: o.s, sz: o.s, tilt: 0, bury: 0.04 };
    case 'reef':
      if (sub === 'coral') return { x: o.x, z: o.z, rot: o.rot, sx: o.s, sy: o.s, sz: o.s, tilt: 0, bury: 0.03 };
      return { x: o.x, z: o.z, rot: o.rot, sx: o.s, sy: o.s * 0.7, sz: o.s, tilt: 0.8, bury: 0.2 * geoH * o.s * 0.7 };
    case 'shell': return { x: o.x, z: o.z, rot: o.rot, sx: o.s, sy: o.s, sz: o.s, tilt: 1, bury: 0.01 };
    case 'gather': return { x: o.x, z: o.z, rot: o.rot, sx: o.s, sy: o.s, sz: o.s, tilt: GATHER_TILT[sub] ?? 0.5, bury: sub === 'kelp' || sub === 'sponge' || sub === 'coral' || sub === 'anemone' ? 0.02 : 0.005 };
    case 'prop': {
      const s = o.s;
      const sp = { x: o.x, z: o.z, rot: o.rot, sx: s, sy: s, sz: s, tilt: sub === 'drain' ? 1 : TILT_PROPS.has(sub) ? 0.8 : 0, bury: TILT_PROPS.has(sub) && !THIN.has(sub) ? 0.03 : 0 };
      if (o.fixedY) sp.y = o.y;
      return sp;
    }
    default: throw new Error('unknown placement category ' + cat);
  }
}

/** write the instance matrix for `geo` placed per `spec` on the world's terrain; returns the matrix */
export function seat(world, geo, spec, out) {
  const P = probesOf(geo);
  _q.setFromAxisAngle(UP, spec.rot || 0);
  if (spec.tilt) {
    // slope of the ground under the whole footprint (not of the one triangle under the centre: small things straddle several)
    let R = 0;
    for (const p of P.pts) R = Math.max(R, Math.hypot(p[0] * spec.sx, p[2] * spec.sz));
    if (R > 0.02) {
      R = Math.min(R, 3);
      const hh = (dx, dz) => world.heightAt(spec.x + dx, spec.z + dz);
      const nx = -(hh(R, 0) - hh(-R, 0)) / (2 * R), nz = -(hh(0, R) - hh(0, -R)) / (2 * R), nl = Math.hypot(nx, 1, nz);
      _n.x = nx / nl; _n.y = 1 / nl; _n.z = nz / nl;
    } else world.faceNormal(spec.x, spec.z, _n);
    const ang = Math.acos(Math.min(1, _n.y));
    if (ang > 1e-4) {
      _ax.set(_n.z, 0, -_n.x).normalize();                     // up x normal
      _qt.setFromAxisAngle(_ax, Math.min(ang * spec.tilt, spec.tilt >= 1 ? 0.8 : 0.5));
      _q.premultiply(_qt);
    }
  }
  let ty;
  if (spec.y !== undefined) ty = spec.y;
  else {
    ty = Infinity;
    for (const p of P.pts) {
      _v.set(p[0] * spec.sx, p[1] * spec.sy, p[2] * spec.sz).applyQuaternion(_q);
      const g = world.heightAt(spec.x + _v.x, spec.z + _v.z) - _v.y;
      if (g < ty) ty = g;
    }
    ty -= spec.bury || 0;
  }
  return out.compose(_p.set(spec.x, ty, spec.z), _q, _sc.set(spec.sx, spec.sy, spec.sz));
}

/** which shared geometry draws this category */
export function geoFor(lib, cat, sub) {
  switch (cat) {
    case 'tree': return lib.tree[sub];
    case 'rock': return lib.rock;
    case 'grass': return lib.grass;
    case 'flower': return lib.flower;
    case 'reed': return lib.reed;
    case 'beach': return lib[sub];
    case 'seagrass': return lib.seagrass;
    case 'reef': return sub === 'coral' ? lib.coral : lib.rock;
    case 'shell': return sub === 't' ? lib.shellt : sub === 'k' ? lib.shellk : lib.shellc;
    case 'prop': return lib.propGeo(sub);
    case 'gather': return lib.gather[sub];
    default: throw new Error('unknown placement category ' + cat);
  }
}
export const geoHeight = (geo) => probesOf(geo).h;

/**
 * Fit a flat decal (water, dew) to the ground under it: a plane through the lowest point of its rim, tilted to the average
 * slope, so a creek running down a hillside is a tilted ribbon of water and not a flat sheet hanging in the air.
 * Returns {y0, gx, gz}: plane height at (x + dx, z + dz) = y0 + gx*dx + gz*dz.
 */
export function fitDisc(world, x, z, r, n = 48) {
  const h = (dx, dz) => world.heightAt(x + dx, z + dz);
  const cap = 0.6;
  const gx = Math.max(-cap, Math.min(cap, (h(r, 0) - h(-r, 0)) / (2 * r))), gz = Math.max(-cap, Math.min(cap, (h(0, r) - h(0, -r)) / (2 * r)));
  let y0 = Infinity;
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, dx = Math.cos(a) * r, dz = Math.sin(a) * r; y0 = Math.min(y0, h(dx, dz) - gx * dx - gz * dz); }
  y0 = Math.min(y0, h(0, 0));
  return { y0: y0 + 0.02, gx, gz };
}
/** instance matrix of a unit-circle decal (radius rx along x, rz along z, yawed) lying on a fitted plane */
export function discMatrix(f, x, z, rx, rz, yaw, out) {
  _n.x = -f.gx; _n.y = 1; _n.z = -f.gz;
  _v.set(_n.x, _n.y, _n.z).normalize();
  _q.setFromAxisAngle(UP, yaw);
  _qt.setFromUnitVectors(UP, _v);
  _q.premultiply(_qt);
  return out.compose(_p.set(x, f.y0, z), _q, _sc.set(rx, 1, rz));
}
const STILL_KINDS = new Set(['puddle', 'dam', 'pond', 'tidepool', 'drip', 'aircon', 'trough']);
/** render radius and plane of a static water source */
export function waterDisc(world, q) {
  if (q._disc) return q._disc;
  const r = q.kind === 'drip' ? q.r * 0.7 : q.kind === 'stream' ? q.r * 1.15 : q.r * 0.96;
  if (STILL_KINDS.has(q.kind) && q.carve) {
    // level water in a dip: the surface is horizontal, just above the floor of the carved hollow
    let y0 = world.heightAt(q.x, q.z);
    for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; y0 = Math.min(y0, world.heightAt(q.x + Math.cos(a) * r, q.z + Math.sin(a) * r)); }
    return (q._disc = { q, r, y0: y0 + 0.02, gx: 0, gz: 0 });
  }
  return (q._disc = { q, r, ...fitDisc(world, q.x, q.z, r) });
}
export const waterDiscs = (world, region) => {
  const far = new Set(); for (const r of world.regions.list) for (const q of r.waters) far.add(q);
  return (region ? region.waters : world.waters.filter((q) => !far.has(q))).filter((q) => q.kind !== 'sprinkler' && q.kind !== 'rain' && q.kind !== 'sea').map((q) => waterDisc(world, q));
};

/** every drawn object of a world as {cat, sub, geo, m} with its final instance matrix (used by the audit) */
export function placedItems(world, lib, opts = {}) {
  // default: the original map. { region } : only that generated far region (see regions.js)
  const reg = opts.region;
  const d = reg ? reg.decor : world.decor, out = [];
  const add = (cat, sub, o) => {
    const geo = geoFor(lib, cat, sub);
    const m = new THREE.Matrix4();
    seat(world, geo, instanceSpec(cat, sub, o, geoHeight(geo)), m);
    out.push({ cat, sub, geo, m });
  };
  for (const t of d.trees) add('tree', t.kind, t);
  for (const r of d.rocks) add('rock', 'r', r);
  for (const g of d.grass) add('grass', 'g', g);
  for (const f of d.flowers) add('flower', 'f', f);
  for (const r of d.reeds) add('reed', 'r', r);
  for (const b of d.beach) add('beach', b.kind, b);
  for (const s of d.seagrass) add('seagrass', 's', s);
  for (const r of d.reef) add('reef', r.kind, r);
  const farP = new Set(), farS = new Set(), farG = new Set();
  for (const r of world.regions.list) { for (const p of r.props) farP.add(p); for (const sh of r.shells) farS.add(sh); for (const g of r.gather) farG.add(g); }
  for (const g of reg ? reg.gather : world.gather) if (reg || !farG.has(g)) add('gather', g.kind, g);
  for (const p of reg ? reg.props : world.props) if (reg || !farP.has(p)) add('prop', p.kind, p);
  if (reg) for (const sh of reg.shells) add('shell', sh.k, { x: sh.x, z: sh.z, rot: sh.rot, s: sh.s });
  else world.shells.forEach((sh, i) => { if (!farS.has(sh)) add('shell', shellKind(i), { x: sh.x, z: sh.z, rot: sh.rot, s: shellScale(i) }); });
  return out;
}
/** which model a collectible shell uses: scallop 'c', turban 't' or cowrie 'k' (by index, so the audit and the renderer agree) */
export const shellKind = (i) => ['c', 't', 'k'][i % 3];
export const shellScale = (i) => 0.85 + ((i * 37) % 10) / 14;
