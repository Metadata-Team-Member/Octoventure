// Placement audit: does everything that is drawn actually SIT on the drawn terrain?
//   node scripts/placement.mjs [legacy]      (legacy = the pre-fix offsets, for the before/after report)
// For every spawned object (props, trees, rocks, grass, flowers, reeds, beach bits, seagrass, reef, shells, water decals,
// taps, sprinklers, landmarks) across several seeds it takes the lowest part of the object, transforms it exactly the way
// the renderer does, and compares it with the terrain MESH (the same triangles _terrainChunk draws, interpolated here with
// an independent implementation). 1 cm at octopus scale = 0.0315 u (octopus ~0.63 u ~ 20 cm).
//   hover  = how far the lowest point of the object is above the surface (a visible gap)       -> fail if > TOL
//   buried = how far the object's base is below the surface at its deepest, vs its own height   -> fail if > limit
import * as THREE from 'three';
import { CONFIG } from '../src/config.js';
import { WorldData } from '../src/world/worldData.js';
import { TOL } from '../src/world/placement.js';
import { PARTS, treeGeometries } from '../src/world/models.js';
import { treeConnectivity } from '../src/world/treeCheck.js';

const LEGACY = process.argv.includes('legacy');
const SEEDS = (process.env.SEEDS || '11,2026,77,5150,9001').split(',').map(Number);
const PLANT = new Set(['grass', 'reed', 'seagrass', 'flower']);
const BUILDING = new Set(['house0', 'house1', 'house2', 'shop', 'barn', 'silo', 'shed', 'shack', 'lighthouse', 'windmill', 'watertower']);

const { buildGeoLib } = await import('../src/world/geoLib.js');
const P = await import('../src/world/placement.js');
const lib = buildGeoLib();

// ---- independent mesh surface: bilinear over the same 2.5 m grid, split along the b-d diagonal like _terrainChunk
function makeSurface(w) {
  const cell = CONFIG.terrainCell, half = w.half, n = Math.round(CONFIG.worldSize / cell);
  const raw = (w.rawHeightAt ?? w.heightAt).bind(w);
  const memo = new Float32Array((n + 1) * (n + 1)).fill(NaN);
  const far = new Map();                                        // no world edge: indices outside the original map use a sparse map
  const g = (ix, iz) => {
    if (ix < 0 || iz < 0 || ix > n || iz > n) {
      const k = iz * 100003 + ix; let v = far.get(k);
      if (v === undefined) { v = raw(-half + ix * cell, -half + iz * cell); far.set(k, v); }
      return v;
    }
    const k = iz * (n + 1) + ix; let v = memo[k];
    if (v !== v) { v = memo[k] = raw(-half + ix * cell, -half + iz * cell); }
    return v;
  };
  return (x, z) => {
    const fx = (x + half) / cell, fz = (z + half) / cell;
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
    const a = g(ix, iz), b = g(ix + 1, iz), d = g(ix, iz + 1), e = g(ix + 1, iz + 1);
    return u + v <= 1 ? a + u * (b - a) + v * (d - a) : e + (1 - u) * (d - e) + (1 - v) * (b - e);
  };
}

// ---- bottom vertices of a geometry (lowest band), cached
const botCache = new WeakMap();
function bottom(geo) {
  let c = botCache.get(geo); if (c) return c;
  geo.computeBoundingBox(); const bb = geo.boundingBox, h = bb.max.y - bb.min.y, pos = geo.attributes.position, pts = [];
  const band = bb.min.y + Math.max(0.02, h * 0.06);
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) <= band) pts.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  c = { pts, h, minY: bb.min.y }; botCache.set(geo, c); return c;
}

// ---- legacy renderer offsets (what the game did before the fix)
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const M = (x, y, z, rx, ry, rz, sx, sy = sx, sz = sx) => _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)).clone();
function legacyItems(w) {
  const d = w.decor, out = [];
  const add = (cat, sub, geo, m, extra = {}) => out.push({ cat, sub, geo, m, ...extra });
  const flowerOld = new THREE.IcosahedronGeometry(0.14, 0);
  for (const t of d.trees) add('tree', t.kind, lib.tree[t.kind], M(t.x, t.y - 0.12, t.z, 0, t.rot, 0, t.scale));
  for (const r of d.rocks) add('rock', 'r', lib.rock, M(r.x, r.y + r.size * r.sy * 0.15, r.z, 0, r.rot, 0, r.size, r.size * r.sy, r.size));
  for (const g of d.grass) add('grass', 'g', lib.grass, M(g.x, g.y - 0.05, g.z, 0, g.rot, 0, g.s));
  for (const f of d.flowers) add('flower', 'f', flowerOld, M(f.x, f.y + 0.38 * f.s, f.z, 0, 0, 0, f.s));
  for (const r of d.reeds) add('reed', 'r', lib.reed, M(r.x, r.y - 0.05, r.z, 0, r.rot, 0, r.s));
  for (const b of d.beach) {
    if (b.kind === 'shell') add('beach', 'shell', lib.shell, M(b.x, b.y + 0.04, b.z, 0.3, b.rot, 0, b.s));
    else if (b.kind === 'weed') add('beach', 'weed', lib.weed, M(b.x, b.y + 0.02, b.z, 0, b.rot, 0, b.s * 1.4, b.s * 0.3, b.s));
    else add('beach', 'wood', lib.wood, M(b.x, b.y + 0.06, b.z, 0, b.rot, 0.1, b.s * 1.3));
  }
  for (const s of d.seagrass) add('seagrass', 's', lib.seagrass, M(s.x, s.y - 0.05, s.z, 0, s.rot, 0, s.s));
  for (const r of d.reef) {
    if (r.kind === 'coral') add('reef', 'coral', lib.coral, M(r.x, r.y - 0.05, r.z, 0, r.rot, 0, r.s));
    else add('reef', 'rock', lib.rock, M(r.x, r.y + r.s * 0.2, r.z, 0, r.rot, 0, r.s, r.s * 0.7, r.s));
  }
  for (const p of w.props) add('prop', p.kind, lib.propGeo(p.kind), M(p.x, p.y, p.z, 0, p.rot, 0, p.s));
  w.shells.forEach((sh, i) => { const s = 0.85 + ((i * 37) % 10) / 14; const k = ['c', 't', 'k'][i % 3]; add('shell', k, { c: lib.shellc, t: lib.shellt, k: lib.shellk }[k], M(sh.x, sh.y + 0.03, sh.z, 0, sh.rot, 0, s)); });
  return out;
}

const TAB = {};
function tally(cat, name, hover, bury, limit, tol = TOL, steep = false) {
  const t = (TAB[cat] ??= { n: 0, hover: 0, buried: 0, maxHover: 0, maxBury: 0, worst: null });
  t.n++;
  if (hover > tol && process.env.HOVLIST) console.log("hover", cat, name, hover.toFixed(2), globalThis.__it ? globalThis.__it : "");
  if (hover > tol) { t.hover++; if (hover > t.maxHover) { t.maxHover = hover; t.worst = name; } }
  if (steep) t.steep = (t.steep || 0) + 1;
  if (bury > limit && !steep) { t.buried++; const k = name; (t.bk ??= {})[k] = ((t.bk ??= {})[k] || 0) + 1; }
  if (bury > t.maxBury) t.maxBury = bury;
}

// ---- tree integrity: every primitive of every tree model must overlap the rest (no floating foliage / loose branches)
let TREE_BAD = 0;
{
  PARTS.on = true; const T = treeGeometries(); PARTS.on = false;
  for (const [kind, g] of Object.entries(T)) {
    const r = treeConnectivity(g.userData.parts, -0.03);          // overlap, not merely tangent
    g.computeBoundingBox();
    const groundGap = g.boundingBox.min.y;                          // models stand on y = 0 (seating adds the rest)
    const ok = r.components.length === 1;
    if (!ok) TREE_BAD++;
    console.log(`  tree ${kind.padEnd(9)} ${String(r.parts).padStart(2)} parts, ${r.components.length} piece(s)${ok ? '' : '  LOOSE parts ' + JSON.stringify(r.loose)}  lowest y ${groundGap.toFixed(2)}`);
  }
}
const TREES = { n: 0, bad: 0 };
const DIP_KINDS = new Set(['puddle', 'dam', 'pond', 'tidepool', 'drip', 'aircon', 'trough']);
const DIP = { clip: 0.12, float: 0.12, bank: 0.1 };       // u (1 u ~ 32 cm). clip: ground above the water at its edge; float: water above the ground at its edge
const DIPS = { n: 0, badWater: 0, badAny: 0, bad: {}, kinds: {}, maxClip: 0, maxFloat: 0, maxTilt: 0 };
const seeds = SEEDS;
const t0 = performance.now();
function auditSet(w, seed, surf, items, waterItems) {
  const v = new THREE.Vector3();
  for (const it of items) {
    const b = bottom(it.geo);
    let hover = -1e9, bury = -1e9;
    for (const p of b.pts) {
      v.copy(p).applyMatrix4(it.m);
      const gap = v.y - surf(v.x, v.z);
      if (gap > hover) hover = gap;
      if (-gap > bury) bury = -gap;
    }
    const sy = Math.hypot(it.m.elements[4], it.m.elements[5], it.m.elements[6]);
    if (it.cat === 'tree') {          // instancing: trees keep uniform scale and stand upright, whatever the yaw / scale
      const e = it.m.elements, sx = Math.hypot(e[0], e[1], e[2]), sz = Math.hypot(e[8], e[9], e[10]);
      TREES.n++; if (Math.abs(sx - sy) > 1e-4 * sy || Math.abs(sz - sy) > 1e-4 * sy || Math.abs(e[5] / sy - 1) > 1e-4) TREES.bad++;
    }
    const height = b.h * sy;
    const lim = it.cat === 'rock' || (it.cat === 'reef' && it.sub === 'rock') ? 0.55 * height + 0.1 : BUILDING.has(it.sub) ? 0.45 * height : PLANT.has(it.cat) ? 0.7 * height : it.sub === 'bush' || it.sub === 'fence' ? 1.0 * height : it.sub === 'wood' ? Math.max(0.6 * height, 0.5) : Math.max(0.5 * height, 0.3);
    const cx = it.m.elements[12], cz = it.m.elements[14], sl = Math.hypot(surf(cx + 1.25, cz) - surf(cx - 1.25, cz), surf(cx, cz + 1.25) - surf(cx, cz - 1.25)) / 2.5;
    if (process.env.DETAIL && it.sub === 'drain' && bury > 0.3) console.log('drain', seed, 'bury', bury.toFixed(2), 'slope', sl.toFixed(2), 'h', height.toFixed(2), 'lim', lim.toFixed(2));
    globalThis.__it = `seed ${seed} at ${cx.toFixed(0)},${cz.toFixed(0)}`;
    tally(it.cat === 'prop' && BUILDING.has(it.sub) ? 'building' : it.cat, it.sub, hover, bury, lim, TOL, sl > 0.5);   // cliffs and the faded world edge are exempt from the bury check
  }
  // water decals: lowest point of the disc rim over the terrain
  for (const wd of waterItems) {
    let hov = -1e9;
    const plane = (dx, dz) => wd.y0 !== undefined ? wd.y0 + wd.gx * dx + wd.gz * dz : wd.y;
    for (let k = 0; k < 36; k++) { const a = (k + 0.37) / 36 * Math.PI * 2, dx = Math.cos(a) * wd.r, dz = Math.sin(a) * wd.r; hov = Math.max(hov, plane(dx, dz) - surf(wd.q.x + dx, wd.q.z + dz)); }
    const hid = surf(wd.q.x, wd.q.z) - plane(0, 0);            // >0 : the centre of the pool is buried under the ground (invisible water)
    tally('water', wd.q.kind, hov, hid, 1.5, 0.175, Math.max(Math.abs(wd.gx ?? 0), Math.abs(wd.gz ?? 0)) >= 0.59);
  }
  // still water (puddles, ponds, dams, tide pools, drips, troughs): the surface must be level, sit in a dip and meet the ground all
  // the way round - no rim clipping into a slope (half in the ground) and no edge hanging in the air
  if (!LEGACY) for (const wd of waterItems) {
    const q = wd.q; if (!DIP_KINDS.has(q.kind) || !q.carve) continue;
    const plane = (dx, dz) => wd.y0 + wd.gx * dx + wd.gz * dz;
    let clip = -1e9, flt = -1e9, bank = 1e9;
    for (let k = 0; k < 36; k++) {
      const a = (k + 0.37) / 36 * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const dr = wd.r, t = surf(q.x + c * dr, q.z + sn * dr), L = plane(c * dr, sn * dr);
      clip = Math.max(clip, t - L); flt = Math.max(flt, L - t);
      bank = Math.min(bank, surf(q.x + c * wd.r * 1.3, q.z + sn * wd.r * 1.3) - plane(c * wd.r * 1.3, sn * wd.r * 1.3));
    }
    const tilt = Math.max(Math.abs(wd.gx), Math.abs(wd.gz));
    const bad = { tilted: tilt > 0.004, clipped: clip > q.depth + DIP.clip, floating: flt > DIP.float, 'above surroundings': bank < -DIP.bank };
    if (process.env.DIPLIST && Object.values(bad).some(Boolean)) console.log('dip', q.kind, seed, q.x.toFixed(0), q.z.toFixed(0), 'r', q.r.toFixed(1), 'depth', q.depth, 'clip', clip.toFixed(2), 'float', flt.toFixed(2), 'bank', bank.toFixed(2), 'spread', w.baseHeight ? (() => { const st = w._ringStats(q.x, q.z, q.r); return st.spread.toFixed(2); })() : '');
    DIPS.n++; DIPS.maxClip = Math.max(DIPS.maxClip, clip); DIPS.maxFloat = Math.max(DIPS.maxFloat, flt); DIPS.maxTilt = Math.max(DIPS.maxTilt, tilt);
    for (const [k, v] of Object.entries(bad)) if (v) { DIPS.bad[k] = (DIPS.bad[k] || 0) + 1; DIPS.badAny++; if (!DIPS.kinds[q.kind + ':' + k]) DIPS.kinds[q.kind + ':' + k] = 0; DIPS.kinds[q.kind + ':' + k]++; }
    if (Object.values(bad).some(Boolean)) DIPS.badWater++;
  }
}
const FAR_TILES = [[4, 1], [-1, 2], [1, -3], [5, 5], [-2, -2], [8, 0], [0, 7], [-4, 3], [12, -9]];
const FARN = { tiles: 0, items: 0 };
for (const seed of seeds) {
  const w = new WorldData(seed);
  const surf = makeSurface(w);
  const items = LEGACY ? legacyItems(w) : P.placedItems(w, lib);
  const waterItems = LEGACY ? w.waters.filter((q) => !['sprinkler', 'rain', 'sea'].includes(q.kind)).map((q) => ({ q, y: q.H - 0.02, r: (q.kind === 'drip' ? q.r * 0.7 : q.kind === 'stream' ? q.r * 1.15 : q.r * 0.96) })) : P.waterDiscs(w);
  auditSet(w, seed, surf, items, waterItems);
  if (!LEGACY && P.placedExtras) for (const ex of P.placedExtras(w)) tally(ex.cat, ex.name, ex.hover(surf), ex.bury(surf), ex.limit);
  // ---- the endless far land: generate tiles (coast, inland, harsh far inland, sea side) and audit them exactly like the original map
  if (!LEGACY) for (const [rx, rz] of FAR_TILES) {
    const reg = w.regions.generate(rx, rz);
    FARN.tiles++; FARN.items += reg.decor.trees.length + reg.decor.rocks.length + reg.decor.grass.length + reg.decor.flowers.length + reg.waters.length + reg.shells.length;
    auditSet(w, seed + `/tile ${rx},${rz}`, surf, P.placedItems(w, lib, { region: reg }), P.waterDiscs(w, reg));
  }
}
const rows = Object.entries(TAB).sort();
let nTot = 0, hTot = 0, bTot = 0;
console.log(`${LEGACY ? 'LEGACY placement' : 'CURRENT placement'}: ${seeds.length} seeds (${seeds.join(', ')}), tolerance ${TOL} u (1 cm at octopus scale)`);
console.log('category'.padEnd(10), 'objects'.padStart(8), 'hover'.padStart(7), 'maxHover'.padStart(9), 'buried'.padStart(7), 'maxBury'.padStart(8), ' on-cliffs  worst hoverer');
if (process.env.DETAIL) for (const [k, t] of rows) if (t.bk) console.log('  buried', k, JSON.stringify(t.bk));
for (const [k, t] of rows) { nTot += t.n; hTot += t.hover; bTot += t.buried; console.log(k.padEnd(10), String(t.n).padStart(8), String(t.hover).padStart(7), t.maxHover.toFixed(2).padStart(9), String(t.buried).padStart(7), t.maxBury.toFixed(2).padStart(8), String(t.steep || 0).padStart(9), ' ', t.worst ?? ''); }
console.log(`far tiles audited: ${FARN.tiles} (${FARN.items} objects, included in every row above)`);
console.log(`tree instances: ${TREES.n} placed, ${TREES.bad} skewed or tilted`);
console.log(`still-water dips: ${DIPS.n} water bodies, ${DIPS.badWater} bad (${JSON.stringify(DIPS.bad)}), max rim clip ${DIPS.maxClip.toFixed(3)} u, max edge float ${DIPS.maxFloat.toFixed(3)} u, max tilt ${DIPS.maxTilt.toFixed(3)}${process.env.DETAIL ? ' ' + JSON.stringify(DIPS.kinds) : ''}`);
console.log(`TOTAL ${nTot} objects, ${hTot} hovering, ${bTot} over-buried   (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
if (!LEGACY && (hTot || bTot || DIPS.badWater || TREES.bad || TREE_BAD)) { console.log('PLACEMENT AUDIT FAILED'); process.exit(1); }
if (!LEGACY) console.log('placement audit passed');
