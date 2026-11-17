// =====================================================================
//  Areas - places everything that makes each biome look, sound and play differently:
//  buildings, fences, props, vegetation, hiding places, squeeze tunnels, shells, baby octopuses,
//  dew patches and landmarks. All randomness comes from world.rnd so a seed (or the daily seed)
//  always reproduces the same world.
// =====================================================================
import { clamp, lerp, smoothstep as ss } from '../util/rng.js';
import { B, BIOMES } from './biomes.js';

export const HOUSE_VARIANTS = [
  { w: 9, d: 8, h: 4.6 }, { w: 11, d: 9, h: 5.2 }, { w: 8, d: 7.5, h: 4.2 },
];
/** collision / climbing footprint of each prop kind: [type, a, b, climb height] (box = half sizes, circle = radius) */
export const TREE_SCALE = 1.7;
export const GRASS_SCALE = 1.6;      // blades 1.1-2.4 u: taller than the 0.4 u-high octopus and many times its length
/** props that are enlarged for the real-scale perspective (uniform, so their colliders scale too); see DESIGN.md */
export const PROP_SCALE = { bin: 1.9, lamp: 1.4, post: 1.6, umbrella: 1.4, log: 1.5, hollowlog: 1.4, crabpot: 1.6, cairn: 1.6, haybale: 1.4, slab: 1.2, trough: 1.3, pylon: 1.2, tin: 1.0 };
const COLLIDE = {
  fence: ['box', 3, 0.18, 3.0], wall: ['box', 3, 0.3, 1.1], shed: ['box', 1.6, 1.6, 2.4], bin: ['circle', 0.55], birdbath: ['circle', 0.4],
  barn: ['box', 7.2, 4.7, 0], silo: ['circle', 3.0], haybale: ['circle', 1.0, 0, 1.5], windmill: ['circle', 0.7], shop: null, parkedcar: ['box', 1.3, 2.9, 1.9],
  lamp: ['circle', 0.25], pylon: ['circle', 0.4], lighthouse: ['circle', 3.4], crabpot: ['circle', 0.55], shack: ['box', 3.2, 2.6, 0], hull: ['circle', 1.6],
  watertower: ['circle', 2.0], cairn: ['circle', 0.7],
};

export function placeAreas(w) {
  const rnd = w.rnd, K = w.areaScale, G = w.cfg.graphics;
  const ctx = { w, rnd, K, G };
  w.lots = [];
  w.decor = { trees: [], rocks: [], grass: [], flowers: [], beach: [], reeds: [], seagrass: [], reef: [] };

  /** push a visual prop (+ collider) and return it */
  const prop = (kind, x, z, o = {}) => {
    const p = { kind, x, z, y: o.y ?? w.heightAt(x, z), rot: o.rot ?? 0, s: (o.s ?? 1) * (PROP_SCALE[kind] ?? 1), tint: o.tint ?? 1, ...o.extra };
    w.props.push(p);
    const c = COLLIDE[kind];
    if (c && o.collide !== false) {
      const quarter = Math.abs(Math.sin(p.rot)) > 0.7;     // rotated a quarter turn: swap the box axes
      if (c[0] === 'box') p.col = w._addBox(x, z, (quarter ? c[2] : c[1]) * p.s, (quarter ? c[1] : c[2]) * p.s, { kind, climb: c[3] > 0, h: c[3] });
      else p.col = w._addCircle(x, z, c[1] * p.s, { kind, climb: !!c[3], h: c[3] || 0 });
    }
    return p;
  };
  ctx.prop = prop;
  const dom = (x, z) => { const q = w.biomes.weights(x, z); let id = 0; for (let i = 1; i < q.length; i++) if (q[i] > q[id]) id = i; return BIOMES[id]; };
  ctx.dom = dom;
  ctx.mix = (x, z) => BIOMES[w.biomes.sample(x, z, rnd())];            // ecotones: pick a biome in proportion to its weight here (see BiomeField.sample)
  const freeSpot = (x, z, pad = 1) => !w._blocked(x, z, pad);

  // ---- 1. buildings, yards, streets, farms ---------------------------------------------------
  suburb(ctx); town(ctx); farm(ctx);
  // ---- 2. the natural landscape ----------------------------------------------------------------
  landmarks(ctx);
  scatterTrees(ctx); scatterRocks(ctx); scatterGround(ctx); riverside(ctx); coastBits(ctx); underwater(ctx);
  // ---- 3. things to find / use ---------------------------------------------------------------------
  hidesAndTunnels(ctx); shellsAndBabies(ctx); dew(ctx);
  void freeSpot; void clamp; void lerp; void ss;
}

// ------------------------------------------------------------------------------------------------ suburb
function suburb(ctx) {
  const { w, rnd, K, prop } = ctx;
  const target = Math.round(14 * K);
  let guard = 0;
  while (w.houses.length < target && guard++ < target * 40) {
    const s = w._spotB(['suburb'], { maxSlope: 0.14, slopeR: 6, tries: 12, minW: 0.7 });
    if (!s) continue;
    const vi = Math.floor(rnd() * HOUSE_VARIANTS.length), V = HOUSE_VARIANTS[vi];
    const yw = V.w / 2 + 8, yd = V.d / 2 + 10;                // yard half sizes (house sits at the front)
    const cx = s.x, cz = s.z - 3;
    // the whole yard must be off the road and clear of other buildings / water
    let bad = false;
    for (const [dx, dz] of [[-yw, -yd], [yw, -yd], [-yw, yd + 3], [yw, yd + 3], [0, 0], [0, yd + 5]]) if (w.isRoad(cx + dx, cz + dz, 2.5)) bad = true;
    if (bad || Math.hypot(s.x - w.start.x, s.z - w.start.z) < 22) continue;
    if (w.houses.some((h) => Math.abs(h.x - s.x) < yw * 2 + 6 && Math.abs(h.z - s.z) < yd * 2 + 6)) continue;
    if (!w._farFromWater(s.x, s.z, 14) || w._blocked(s.x, s.z, 6)) continue;
    const y = w.baseHeight(s.x, s.z);
    const house = { x: s.x, z: s.z, w: V.w, d: V.d, h: V.h, y, variant: vi };
    w.houses.push(house);
    prop('house' + vi, s.x, s.z, { y, collide: false });
    w._addBox(s.x, s.z, V.w / 2 + 0.3, V.d / 2 + 0.3, { kind: 'house' });
    yard(ctx, cx, cz, yw, yd, s, V);
  }
}

function yard(ctx, cx, cz, yw, yd, door, V) {
  const { w, rnd, prop } = ctx;
  const doorX = door.x, front = cz + yd;
  const seg = 6;
  const holeSide = rnd() < 0.8 ? Math.floor(rnd() * 3) : -1;           // 0 back, 1 left, 2 right
  const fences = [];
  // back (-z) & front (+z, with a gate gap) run along x ; sides run along z
  for (let x = cx - yw + seg / 2; x < cx + yw - 0.1; x += seg) {
    fences.push({ x, z: cz - yd, rot: 0, side: 0 });
    if (Math.abs(x - doorX) > 4.5) fences.push({ x, z: front, rot: 0, side: 3 });
  }
  for (let z = cz - yd + seg / 2; z < cz + yd - 0.1; z += seg) {
    fences.push({ x: cx - yw, z, rot: Math.PI / 2, side: 1 });
    fences.push({ x: cx + yw, z, rot: Math.PI / 2, side: 2 });
  }
  let holed = false;
  for (const f of fences) {
    if (w.isRoad(f.x, f.z, 0.5) || w.inLot(f.x, f.z, 1) || w.waterAt(f.x, f.z)) continue;
    const p = prop('fence', f.x, f.z, { rot: f.rot });
    if (!holed && f.side === holeSide + 0 && f.side < 3) {
      holed = true; p.extra = { hole: true };
      const nx = f.rot ? 1 : 0, nz = f.rot ? 0 : 1;      // normal of the fence
      const A = { x: f.x - nx * 1.6, z: f.z - nz * 1.6 }, Bp = { x: f.x + nx * 1.6, z: f.z + nz * 1.6 };
      w.tunnels.push({ a: A, b: Bp, kind: 'fence', wet: false });
      prop('fencehole', f.x, f.z, { rot: f.rot, collide: false });
    }
  }
  // things in the yard
  if (rnd() < 0.55) { const x = cx + yw - 3, z = cz - yd + 3; if (!w._blocked(x, z, 0.5)) prop('shed', x, z, {}); }
  const nb = 1 + (rnd() < 0.5 ? 1 : 0);
  for (let i = 0; i < nb; i++) { const x = door.x + V.w / 2 + 1.4 + i * 1.3, z = door.z - V.d / 2 + 0.6; if (!w._blocked(x, z, 0.4)) addBin(ctx, x, z); }
  if (rnd() < 0.55) { const x = cx + rnd.range(-yw * 0.5, yw * 0.5), z = cz - rnd.range(0, yd * 0.5); if (!w._blocked(x, z, 1.5)) { prop('birdbath', x, z, {}); w._addWater('birdbath', x, z, 1.15, { carve: false }); } }
  if (rnd() < 0.65) { const x = door.x - 2.4, z = door.z + V.d / 2 + 1.4; w._addWater('bowl', x, z, 0.95, { carve: false }); prop('bowl', x, z, { collide: false }); }
  if (rnd() < 0.4) { const x = door.x + V.w / 2 + 1.2, z = door.z + 1.5; if (w._farFromWater(x, z, 5)) { w._addWater('hose', x, z, 1.7, { depth: 0.06 }); w.taps.push({ type: 'tap', x, z, rot: 0 }); } }
}

function addBin(ctx, x, z) {
  const { w, prop } = ctx;
  prop('bin', x, z, { rot: ctx.rnd() * 6.28 });
  w.seasonal.push({ kind: 'bin', gate: 'wet', x, z, r: 1.5, y: w.heightAt(x, z), lift: 1.12 });
}

// ------------------------------------------------------------------------------------------------ town: streets, shops, car parks
function town(ctx) {
  const { w, rnd, K, prop } = ctx;
  // shops next to air-con drips
  for (const t of w.taps) {
    if (t.type !== 'ac') continue;
    const bx = t.x + 5.6, bz = t.z;
    if (w.isRoad(bx - 6, bz, 3) || w.isRoad(bx + 6, bz, 3) || w.isRoad(bx, bz - 5, 3) || w.isRoad(bx, bz + 5, 3) || w._blocked(bx, bz, 4)) { t.noWall = true; continue; }
    t.rot = 0; t.wallX = t.x + 0.55;
    prop('shop', bx, bz, { rot: 0, tint: rnd.range(0.85, 1.1), collide: false });
    w._addBox(bx, bz, 5.5, 4.5, { kind: 'shop' });
  }
  // a few more shops along the streets
  let made = 0;
  for (let i = 0; i < 400 && made < Math.round(10 * K); i++) {
    const s = w._spotB(['town'], { maxSlope: 0.1, tries: 10, minW: 0.7 });
    if (!s || w._blocked(s.x, s.z, 8) || !w._farFromWater(s.x, s.z, 8)) continue;
    if ([[-6, 0], [6, 0], [0, -5], [0, 5]].some(([dx, dz]) => w.isRoad(s.x + dx, s.z + dz, 3) || w.inLot(s.x + dx, s.z + dz, 2))) continue;
    prop('shop', s.x, s.z, { tint: rnd.range(0.85, 1.1), collide: false });
    w._addBox(s.x, s.z, 5.5, 4.5, { kind: 'shop' });
    made++;
  }
  // car parks: paved lots full of parked cars
  made = 0;
  for (let i = 0; i < 600 && made < Math.round(3 * K); i++) {
    const s = w._spotB(['town'], { maxSlope: 0.07, tries: 10, minW: 0.7, notRoad: false });
    if (!s || w._blocked(s.x, s.z, 14)) continue;
    const hw = 22, hd = 14;
    if ([[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]].some(([dx, dz]) => w.isRoad(s.x + dx, s.z + dz, 2))) continue;
    if (w.lots.some((l) => Math.abs(l.x - s.x) < 60 && Math.abs(l.z - s.z) < 40)) continue;
    w.lots.push({ x: s.x, z: s.z, hw, hd });
    for (let a = 0; a < 6; a++) for (const row of [-1, 1]) {
      if (rnd() < 0.35) continue;
      prop('parkedcar', s.x - 17 + a * 6.8, s.z + row * 5.5, { rot: 0, tint: rnd.range(0, 1), extra: { hue: rnd() } });
    }
    for (const [dx, dz] of [[-hw + 1, -hd + 1], [hw - 1, -hd + 1], [-hw + 1, hd - 1], [hw - 1, hd - 1]]) prop('lamp', s.x + dx, s.z + dz, {});
    // puddles & a drip-prone drain in the lot
    if (w._farFromWater(s.x + 10, s.z, 6) && w._ringStats(s.x + 10, s.z, 3.0).spread < 0.15 && w.creekDist(s.x + 10, s.z) > 18) w._addWater('puddle', s.x + 10, s.z, 3.0);
    made++;
  }
  // street bins & lamps along the roads
  made = 0;
  for (let i = 0; i < 800 && made < Math.round(14 * K); i++) {
    const s = w._spotB(['town'], { maxSlope: 0.1, tries: 10, minW: 0.7, notRoad: false });
    if (!s || w.isRoad(s.x, s.z, 0) || !w.isRoad(s.x, s.z, 3.4) || w._blocked(s.x, s.z, 1)) continue;
    addBin(ctx, s.x, s.z); made++;
  }
  made = 0;
  for (let i = 0; i < 800 && made < Math.round(24 * K); i++) {
    const s = w._spotB(['town', 'suburb'], { maxSlope: 0.1, tries: 10, minW: 0.6, notRoad: false });
    if (!s || w.isRoad(s.x, s.z, 0) || !w.isRoad(s.x, s.z, 3.0) || w._blocked(s.x, s.z, 1)) continue;
    prop('lamp', s.x, s.z, {}); made++;
  }
  // storm drains: wet shortcuts under the street
  made = 0;
  for (let i = 0; i < 900 && made < Math.round(8 * K); i++) {
    const s = w._spotB(['town', 'suburb'], { maxSlope: 0.1, tries: 10, minW: 0.6, notRoad: false });
    if (!s || w.isRoad(s.x, s.z, 0) || !w.isRoad(s.x, s.z, 3.4)) continue;
    // exit along the road
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const d = dirs[Math.floor(rnd() * 4)], len = rnd.range(34, 70);
    const ex = s.x + d[0] * len, ez = s.z + d[1] * len;
    if (!w.isRoad(ex, ez, 3.4) || w.isRoad(ex, ez, 0) || w._blocked(ex, ez, 0.8) || w._blocked(s.x, s.z, 0.8)) continue;
    if (Math.abs(ex) > w.half - 6 || Math.abs(ez) > w.half - 6) continue;                // both grates stay inside the original map
    const flat = (px, pz) => { const h0 = w.heightAt(px, pz); return [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].every(([a, b]) => Math.abs(w.heightAt(px + a, pz + b) - h0) <= 0.25); };
    if (!flat(ex, ez) || !flat(s.x, s.z)) continue;                                       // a drain grate lies flat
    w.tunnels.push({ a: { x: s.x, z: s.z }, b: { x: ex, z: ez }, kind: 'drain', wet: true });
    prop('drain', s.x, s.z, { collide: false }); prop('drain', ex, ez, { collide: false });
    made++;
  }
}

// ------------------------------------------------------------------------------------------------ farm
function farm(ctx) {
  const { w, rnd, K, prop } = ctx;
  const cells = new Map();
  for (let cx = Math.floor(-w.half / 70); cx < w.half / 70; cx++) for (let cz = Math.floor(-w.half / 70); cz < w.half / 70; cz++) {
    const x = cx * 70 + 35, z = cz * 70 + 35;
    if (Math.abs(x) > w.half - 80 || Math.abs(z) > w.half - 80) continue;
    if (w.biomes.weights(x, z)[B.farm] < 0.7) continue;
    cells.set(cx + ',' + cz, { cx, cz, x, z });
  }
  const list = [...cells.values()];
  // farmsteads
  const farmsteads = Math.min(list.length, Math.round(2 * K));
  const shuffled = list.slice().sort(() => rnd() - 0.5);
  for (let i = 0; i < farmsteads; i++) {
    const c = shuffled[i];
    const bx = c.x - 16, bz = c.z + 10;
    if (w._blocked(bx, bz, 8) || w.waterAt(bx, bz)) continue;
    prop('barn', bx, bz, {});
    const hx = c.x + 12, hz = c.z + 14;
    if (!w._blocked(hx, hz, 8)) { const V = HOUSE_VARIANTS[1]; w.houses.push({ x: hx, z: hz, w: V.w, d: V.d, h: V.h, y: w.baseHeight(hx, hz), variant: 1, farm: true }); prop('house1', hx, hz, { collide: false }); w._addBox(hx, hz, V.w / 2 + 0.3, V.d / 2 + 0.3, { kind: 'house' }); }
    if (!w._blocked(c.x - 2, c.z - 14, 4)) prop('silo', c.x - 2, c.z - 14, {});
    const mx = c.x + 18, mz = c.z - 10;
    if (!w._blocked(mx, mz, 4)) { prop('windmill', mx, mz, {}); w.landmarks.push({ kind: 'windmill', x: mx, z: mz }); w._addWater('trough', mx + 2.5, mz, 1.8, { carve: false }); prop('trough', mx + 2.5, mz, { collide: false }); }
    for (let k = 0; k < 6; k++) { const x = c.x + rnd.range(-25, 25), z = c.z + rnd.range(-25, 25); if (!w._blocked(x, z, 2)) prop('haybale', x, z, { rot: rnd() * 6.28 }); }
    // a pipe shortcut across the yard
    w.tunnels.push({ a: { x: c.x - 3, z: c.z + 20 }, b: { x: c.x + 22, z: c.z + 28 }, kind: 'pipe', wet: false });
    prop('pipe', c.x - 3, c.z + 20, { collide: false }); prop('pipe', c.x + 22, c.z + 28, { collide: false });
  }
  // paddocks: fenced cells with troughs; every cell edge shared by two fenced cells is only built once
  const edges = new Set();
  for (const c of list) {
    if (rnd() < 0.45) continue;
    const x0 = c.cx * 70, z0 = c.cz * 70;
    const sides = [['h', x0, z0], ['h', x0, z0 + 70], ['v', x0, z0], ['v', x0 + 70, z0]];
    for (const [t, ex, ez] of sides) {
      const key = t + ex + ',' + ez;
      if (edges.has(key)) continue; edges.add(key);
      for (let s = 3; s < 70; s += 6) {
        if (s > 28 && s < 40 && ((c.cx + c.cz) & 1)) continue;          // a gap (gate) in half the paddocks
        const x = t === 'h' ? ex + s : ex, z = t === 'h' ? ez : ez + s;
        if (w.waterAt(x, z) || w._blocked(x, z, 0.4) || w.isRoad(x, z, 0)) continue;
        prop('fence', x, z, { rot: t === 'h' ? 0 : Math.PI / 2 });
      }
    }
    if (rnd() < 0.7) { const x = c.x + rnd.range(-20, 20), z = c.z + rnd.range(-20, 20); if (!w._blocked(x, z, 3) && w._farFromWater(x, z, 8)) { w._addWater('trough', x, z, 1.8, { carve: false }); prop('trough', x, z, { collide: false }); } }
  }
}

// ------------------------------------------------------------------------------------------------ landmarks
function landmarks(ctx) {
  const { w, rnd, prop } = ctx;
  // lighthouse: on the rocky headland, near the cliff edge
  const hu = w.coastCentre('headland', 0);
  let best = null;
  for (let du = -80; du <= 80; du += 10) for (let tt = 0.84; tt <= 0.93; tt += 0.01) {
    const p = w.shorePoint(hu + du, tt);
    if (Math.abs(p.x) > w.half - 60 || Math.abs(p.z) > w.half - 60) continue;
    const h = w.heightAt(p.x, p.z);
    if (!best || h > best.h) best = { x: p.x, z: p.z, h };
  }
  if (best) { prop('lighthouse', best.x, best.z, { y: best.h }); w.landmarks.push({ kind: 'lighthouse', x: best.x, z: best.z, y: best.h }); }
  // Norfolk pines along the back of the beach and on the headland (tall - visible from far inland)
  const bu = w.coastCentre('beach', 0);
  for (const u0 of [bu, hu]) {
    for (let k = -5; k <= 5; k++) {
      const p = w.shorePoint(u0 + k * 38 + rnd.range(-8, 8), w.biomes.coastKinds(u0)[2] > 0.5 ? 0.82 : 0.885);
      if (Math.abs(p.x) > w.half - 50 || Math.abs(p.z) > w.half - 50) continue;
      const q = w.biomes.weights(p.x, p.z);
      if (q[B.beach] + q[B.dunes] + q[B.headland] < 0.5 || w._blocked(p.x, p.z, 1.5)) continue;
      const h = w.heightAt(p.x, p.z); if (h < 0.9) continue;
      w.decor.trees.push({ x: p.x, z: p.z, y: h, kind: 'norfolk', scale: rnd.range(1.5, 2.2), rot: rnd() * 6.28, tint: rnd.range(0.9, 1.05) });
      w._addCircle(p.x, p.z, 0.8, { kind: 'tree' });
      w.landmarks.push({ kind: 'norfolk', x: p.x, z: p.z });
    }
  }
  // water tower in town (another inland landmark)
  const t = w._spotB(['town'], { maxSlope: 0.08, tries: 200, minW: 0.7 });
  if (t && !w._blocked(t.x, t.z, 6)) { prop('watertower', t.x, t.z, {}); w.landmarks.push({ kind: 'watertower', x: t.x, z: t.z }); }
}

// ------------------------------------------------------------------------------------------------ trees
export const TREE_RULES = {
  suburb:    { p: 0.12, kinds: [['oak', 0.55], ['bush', 0.35], ['palm', 0.1]] },
  town:      { p: 0.025, kinds: [['oak', 0.5], ['bush', 0.5]] },
  farm:      { p: 0.035, kinds: [['gum', 0.6], ['oak', 0.2], ['bush', 0.2]] },
  bush:      { p: 0.5,  kinds: [['gum', 0.68], ['pine', 0.08], ['bush', 0.24]] },
  riverbank: { p: 0.35, kinds: [['willow', 0.4], ['gum', 0.35], ['bush', 0.25]] },
  wetland:   { p: 0.38, kinds: [['paperbark', 0.7], ['bush', 0.3]] },
  dunes:     { p: 0.05, kinds: [['bush', 1]] },
  beach:     { p: 0.008, kinds: [['palm', 1]] },
  headland:  { p: 0.07, kinds: [['bush', 0.7], ['pine', 0.3]] },
  estuary:   { p: 0.05, kinds: [['mangrove', 0.6], ['paperbark', 0.4]] },
  desert:    { p: 0.02, kinds: [['bush', 0.75], ['gum', 0.25]] },                 // mulga scrub and the odd ghost gum
  rainforest:{ p: 0.85, kinds: [['gum', 0.4], ['oak', 0.25], ['palm', 0.15], ['pine', 0.05], ['bush', 0.15]] },   // tall canopy, bangalow palms, understorey
};
function scatterTrees(ctx) {
  const { w, rnd, K, G } = ctx;
  const target = Math.round(G.treeCount * K);
  const trees = w.decor.trees;
  const edge = 30;
  let tries = 0;
  const startTrees = trees.length;
  while (trees.length - startTrees < target && tries++ < target * 22) {
    const x = rnd.range(-w.half + edge, w.half - edge), z = rnd.range(-w.half + edge, w.half - edge);
    const b = ctx.mix(x, z);
    const rule = TREE_RULES[b];
    if (!rule || rnd() > rule.p) continue;
    const tw = w.tAt(x, z);
    let kind = null, r = rnd(), acc = 0;
    for (const [k, p] of rule.kinds) { acc += p; if (r <= acc) { kind = k; break; } }
    if (!kind) continue;
    if (b === 'wetland') kind = tw > 0.84 ? 'mangrove' : kind === 'mangrove' ? 'paperbark' : kind;
    if (b === 'estuary' && tw > 0.93) continue;
    if (Math.hypot(x - w.start.x, z - w.start.z) < 7 || w.isRoad(x, z, 2.2) || w.inLot(x, z, 2) || w._blocked(x, z, 1.2)) continue;
    const h = w.heightAt(x, z);
    if (h < (kind === 'mangrove' ? 0.12 : 0.9)) continue;
    const scale = (kind === 'bush' ? rnd.range(0.7, 1.4) : kind === 'gum' ? rnd.range(1.0, 1.8) : rnd.range(0.8, 1.7)) * (kind === 'bush' ? 1.3 : TREE_SCALE);   // real-scale perspective: trees are giants next to a 20 cm octopus
    trees.push({ x, z, y: h, kind, scale, rot: rnd() * 6.28, tint: rnd.range(0.82, 1.1) });
    if (kind !== 'bush') w._addCircle(x, z, (kind === 'mangrove' ? 0.7 : 0.5) * scale, { kind: 'tree' });
  }
}

function scatterRocks(ctx) {
  const { w, rnd, K, G } = ctx;
  const target = Math.round(G.rockCount * K);
  const P = { suburb: 0.002, town: 0, farm: 0.02, bush: 0.07, riverbank: 0.15, wetland: 0, dunes: 0.01, beach: 0.02, headland: 0.5, estuary: 0.01, desert: 0.05, rainforest: 0.06 };
  let tries = 0, n = 0;
  while (n < target && tries++ < target * 40) {
    const x = rnd.range(-w.half + 30, w.half - 30), z = rnd.range(-w.half + 30, w.half - 30);
    const b = ctx.mix(x, z);
    let p = P[b] ?? 0;
    if (b === 'bush' && w.baseType(x, z) === 'rock') p = 0.5;
    if (b === 'headland' && w.tAt(x, z) > 0.96) p = 0.12;
    if (rnd() > p) continue;
    if (Math.hypot(x - w.start.x, z - w.start.z) < 7 || w._blocked(x, z, 1) || w.isRoad(x, z, 1)) continue;
    const h = w.heightAt(x, z);
    if (h < 0.7) continue;
    if (b === 'desert' && rnd() < 0.45) {                     // termite mounds: tall, narrow, red earth (t241u)
      const size = rnd.range(0.35, 0.75);
      w.decor.rocks.push({ x, z, y: h, size, rot: rnd() * 6.28, sy: rnd.range(2.4, 4.2), tint: rnd.range(0.85, 1.05), red: true, mound: true });
      w._addCircle(x, z, size * 0.85, { kind: 'rock' }); n++; continue;
    }
    const size = rnd() < (b === 'headland' ? 0.25 : 0.12) ? rnd.range(2.2, 4) : b === 'desert' ? rnd.range(0.3, 0.9) : rnd.range(0.5, 1.8);
    w.decor.rocks.push({ x, z, y: h, size, rot: rnd() * 6.28, sy: rnd.range(0.55, 1.0), tint: rnd.range(0.8, 1.1), dark: b === 'headland', red: b === 'desert' });
    w._addCircle(x, z, size * 0.85, { kind: 'rock' });
    n++;
  }
}

function scatterGround(ctx) {
  const { w, rnd, K, G } = ctx;
  const grass = w.decor.grass, flowers = w.decor.flowers;
  const P = { lawn: 0.9, grass: 1, pasture: 1, litter: 0.38, scrub: 0.5, dunegrass: 0.8, dune: 0.15, swamp: 0.3, mud: 0.12, bank: 0.4, gravel: 0.05, forest: 0.6, headland: 0.1, rock: 0.04, spinifex: 0.9, redsand: 0.12, gibber: 0.05, fern: 1, mossy: 0.7 };
  let tries = 0;
  const gt = Math.round(G.grassCount * K);
  while (grass.length < gt && tries++ < gt * 8) {
    const x = rnd.range(-w.half + 30, w.half - 30), z = rnd.range(-w.half + 30, w.half - 30);
    const tp = w.baseType(x, z);
    if (rnd() > (P[tp] ?? 0)) continue;
    if (w.isRoad(x, z, 1) || w.inLot(x, z, 1)) continue;
    const h = w.heightAt(x, z);
    if (h < 0.9) continue;
    const dry = tp === 'spinifex' || tp === 'redsand' || tp === 'gibber' || tp === 'scrub' || tp === 'dune' || tp === 'dunegrass' || tp === 'pasture' && rnd() < 0.4 || tp === 'litter';
    grass.push({ x, z, y: h, s: rnd.range(0.7, 1.5) * GRASS_SCALE * (tp === 'dune' || tp === 'dunegrass' ? 1.4 : tp === 'spinifex' ? 1.3 : tp === 'fern' ? 1.35 : 1), rot: rnd() * 6.28, dry, tint: rnd.range(0.8, 1.15), wet: tp === 'swamp' });
  }
  tries = 0;
  const ft = Math.round(G.flowerCount * K);
  while (flowers.length < ft && tries++ < ft * 12) {
    const x = rnd.range(-w.half + 30, w.half - 30), z = rnd.range(-w.half + 30, w.half - 30);
    const tp = w.baseType(x, z);
    if (tp !== 'lawn' && tp !== 'grass' && tp !== 'pasture' && !(tp === 'litter' && rnd() < 0.3)) continue;
    const h = w.heightAt(x, z);
    if (h < 1 || w.isRoad(x, z, 1)) continue;
    flowers.push({ x, z, y: h, color: rnd.pick(tp === 'litter' ? [0xffe066, 0xffffff, 0xd96a3a] : [0xffe066, 0xff8fa3, 0xffffff, 0xc77dff, 0xff9f45]), s: rnd.range(0.7, 1.2) });
  }
}

function riverside(ctx) {
  const { w, rnd } = ctx;
  const reeds = w.decor.reeds;
  // reeds around the water (ponds heavy, streams light) - all biomes
  for (const q of w.waters) {
    if (q.kind === 'sprinkler' || q.kind === 'drip' || q.kind === 'birdbath' || q.kind === 'bowl' || q.kind === 'hose' || q.kind === 'aircon' || q.kind === 'trough') continue;
    if (q.kind === 'stream' && rnd() < 0.7) continue;
    const n = q.kind === 'pond' || q.kind === 'dam' ? 12 : q.kind === 'stream' || q.kind === 'estuary' ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, d = q.r * rnd.range(1.0, 1.35);
      const x = q.x + Math.cos(a) * d, z = q.z + Math.sin(a) * d;
      const tp = w.baseType(x, z);
      if (tp === 'road' || tp === 'sand' || tp === 'dune' || tp === 'wet' || tp === 'paving' || tp === 'rock') continue;
      reeds.push({ x, z, y: w.heightAt(x, z), s: rnd.range(0.8, 1.6), rot: rnd() * 6.28 });
    }
  }
  // stepping stones & driftwood along the creek; fallen logs on the banks
  for (let i = 0; i < w.creek.length; i += 9) {
    const p = w.creek[i]; if (w.tAt(p.x, p.z) > 0.88) break;
    const a = rnd() * 6.28, d = rnd.range(1.5, 3.2);
    const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
    w.decor.rocks.push({ x, z, y: w.heightAt(x, z), size: rnd.range(0.4, 0.9), rot: rnd() * 6.28, sy: 0.6, tint: 1, dark: false });
    if (rnd() < 0.4) { const lx = p.x + Math.cos(a) * 6, lz = p.z + Math.sin(a) * 6; if (!w._blocked(lx, lz, 1.5)) ctx.prop('log', lx, lz, { rot: rnd() * 6.28, collide: false }); }
  }
}

function coastBits(ctx) {
  const { w, rnd, K, prop } = ctx;
  const beach = w.decor.beach;
  const target = Math.round(220 * K);
  for (let i = 0; i < target * 12 && beach.length < target; i++) {
    const x = rnd.range(-w.half + 30, w.half - 30), z = rnd.range(-w.half + 30, w.half - 30);
    const tt = w.tAt(x, z);
    if (tt < 0.88 || tt > 1.0) continue;
    const b = ctx.dom(x, z);
    if (b !== 'beach' && b !== 'estuary' && b !== 'headland' && b !== 'dunes' && b !== 'wetland') continue;
    const h = w.heightAt(x, z);
    if (h < 0.05) continue;
    beach.push({ x, z, y: h, kind: rnd.pick(['shell', 'shell', 'weed', 'weed', 'wood']), rot: rnd() * 6.28, s: rnd.range(0.7, 1.4) });
  }
  // beach: umbrellas & towels (people come here), sand-fence posts on the dunes
  let n = 0;
  for (let i = 0; i < 3000 && n < Math.round(7 * K); i++) {
    const x = rnd.range(-w.half + 40, w.half - 40), z = rnd.range(-w.half + 40, w.half - 40);
    if (ctx.dom(x, z) !== 'beach') continue;
    const tt = w.tAt(x, z);
    if (tt < 0.92 || tt > 0.955 || w._blocked(x, z, 2)) continue;
    prop('umbrella', x, z, { rot: rnd() * 6.28, collide: false, extra: { hue: rnd() } });
    prop('towel', x + 1.4, z + 0.5, { rot: rnd() * 6.28, collide: false, extra: { hue: rnd() } });
    n++;
  }
  n = 0;
  for (let i = 0; i < 5000 && n < Math.round(50 * K); i++) {
    const x = rnd.range(-w.half + 40, w.half - 40), z = rnd.range(-w.half + 40, w.half - 40);
    if (ctx.dom(x, z) !== 'dunes') continue;
    const tt = w.tAt(x, z);
    if (tt < 0.86 || tt > 0.9) continue;
    prop('post', x, z, { rot: rnd() * 6.28, collide: false }); n++;
  }
  // estuary: the jetty, boats, crab pots, a fishing shack
  const eu = w.coast.estuaryU + 70;
  let landT = 0.9;
  for (let t = 0.85; t < 1.0; t += 0.004) { const p = w.shorePoint(eu, t); if (w.heightAt(p.x, p.z) < 0.5) { landT = t; break; } }
  const a = w.shorePoint(eu, landT - 0.03), b = w.shorePoint(eu, 1.0 + 0.1);
  const len = Math.hypot(b.x - a.x, b.z - a.z), steps = Math.floor(len / 4);
  for (let i = 0; i <= steps; i++) {
    const x = lerp(a.x, b.x, i / steps), z = lerp(a.z, b.z, i / steps);
    prop('plank', x, z, { y: 1.55, rot: Math.atan2(w.dir.x, w.dir.z), collide: false });
    if (i % 2 === 0) for (const s of [-1, 1]) {
      const px = x + w.perp.x * s * 1.5, pz = z + w.perp.z * s * 1.5;
      prop('pylon', px, pz, { y: Math.min(w.heightAt(px, pz), 0) - 0.6 });
    }
  }
  w.landmarks.push({ kind: 'jetty', x: a.x, z: a.z, bx: b.x, bz: b.z });
  w.jetty = { a, b, len };
  const sh = w.shorePoint(eu - 22, landT - 0.045);
  if (!w._blocked(sh.x, sh.z, 4) && w.heightAt(sh.x, sh.z) > 0.6) prop('shack', sh.x, sh.z, {});
  for (let i = 0; i < Math.round(3 * K); i++) {
    const p = w.shorePoint(w.coast.estuaryU + rnd.range(-110, 160), rnd.range(0.93, 0.985));
    if (w.heightAt(p.x, p.z) < 0.15 || w._blocked(p.x, p.z, 3)) continue;
    prop('hull', p.x, p.z, { rot: rnd() * 6.28, tint: rnd() });
  }
  for (let i = 0; i < Math.round(8 * K); i++) {
    const p = w.shorePoint(w.coast.estuaryU + rnd.range(-130, 180), rnd.range(0.9, 0.985));
    if (w.heightAt(p.x, p.z) < 0.15 || w._blocked(p.x, p.z, 1)) continue;
    prop('crabpot', p.x, p.z, { rot: rnd() * 6.28 });
  }
  // headland cairns
  for (let i = 0; i < Math.round(3 * K); i++) {
    const p = w.shorePoint(w.coastCentre('headland', 0) + rnd.range(-120, 120), rnd.range(0.8, 0.9));
    if (w.heightAt(p.x, p.z) < 1.5 || w._blocked(p.x, p.z, 2) || ctx.dom(p.x, p.z) !== 'headland') continue;
    prop('cairn', p.x, p.z, {});
  }
}

function underwater(ctx) {
  const { w, rnd, K } = ctx;
  // seagrass meadows in the shallows, coral & rock reef a little further out
  const sg = w.decor.seagrass, reef = w.decor.reef;
  const tg = Math.round(2400 * K), tr = Math.round(260 * K);
  let tries = 0;
  while ((sg.length < tg || reef.length < tr) && tries++ < (tg + tr) * 12) {
    const x = rnd.range(-w.half + 30, w.half - 30), z = rnd.range(-w.half + 30, w.half - 30);
    const tt = w.tAt(x, z);
    if (tt < 1.01 || tt > 1.7) continue;
    const h = w.heightAt(x, z);
    if (h > -0.5 || h < -6.5) continue;
    const kinds = w.biomes.coastKinds(w.lateral(x, z));
    if (sg.length < tg && h > -4.5 && (kinds[1] + kinds[3] + kinds[0] * 0.7) * w.n.fbm(x * 0.03, z * 0.03, 2) > 0.1) sg.push({ x, z, y: h, s: rnd.range(0.8, 1.6), rot: rnd() * 6.28 });
    else if (reef.length < tr && (kinds[2] * 1.4 + kinds[0] * 0.5) * (0.5 + w.n.fbm(x * 0.02 + 5, z * 0.02, 2)) > 0.4) {
      const coral = rnd() < 0.55;
      reef.push({ x, z, y: h, kind: coral ? 'coral' : 'rock', s: coral ? rnd.range(0.7, 1.7) : rnd.range(0.8, 2.4), rot: rnd() * 6.28, hue: rnd() });
      if (!coral) w._addCircle(x, z, 0.8, { kind: 'rock' });
    }
  }
}

// ------------------------------------------------------------------------------------------------ hides, tunnels, shells, babies
function hidesAndTunnels(ctx) {
  const { w, rnd, K, prop } = ctx;
  const plan = [['tin', ['town', 'suburb', 'beach', 'estuary'], 12, 0.7], ['shellhide', ['beach', 'estuary', 'headland'], 12, 0.65], ['slab', ['headland', 'bush', 'riverbank'], 10, 0.6], ['hollowlog', ['bush', 'wetland'], 8, 0.7]];
  for (const [kind, names, count, minW] of plan) {
    let n = 0;
    for (let i = 0; i < count * K * 25 && n < count * K; i++) {
      const s = w._spotB(names, { maxSlope: 0.25, tries: 10, minW: minW - 0.2, minH: 0.25, notRoad: false });
      if (!s || w._blocked(s.x, s.z, 1.2) || w.waterAt(s.x, s.z)) continue;
      if (kind === 'tin' && w.isRoad(s.x, s.z, 0)) continue;
      prop(kind, s.x, s.z, { rot: rnd() * 6.28, collide: false, s: kind === 'slab' ? rnd.range(1, 1.5) : 1 });
      w.hides.push({ x: s.x, z: s.z, r: kind === 'slab' ? 1.6 : kind === 'hollowlog' ? 1.5 : 1.1, kind });
      n++;
    }
  }
  // culverts: wet crossings under the creek banks, outfall pipes at the estuary
  let n = 0;
  for (let i = 0; i < w.creek.length && n < Math.round(4 * K); i += 31) {
    const p = w.creek[i], q = w.creek[Math.min(w.creek.length - 1, i + 1)];
    if (i < 20 || w.tAt(p.x, p.z) > 0.8) continue;
    const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l, nz = dx / l;
    const A = { x: p.x + nx * 7, z: p.z + nz * 7 }, Bp = { x: p.x - nx * 7, z: p.z - nz * 7 };
    if (w._blocked(A.x, A.z, 1) || w._blocked(Bp.x, Bp.z, 1) || w.heightAt(A.x, A.z) < 0.4 || w.heightAt(Bp.x, Bp.z) < 0.4) continue;
    w.tunnels.push({ a: A, b: Bp, kind: 'culvert', wet: true });
    prop('culvert', A.x, A.z, { rot: Math.atan2(nx, nz), collide: false }); prop('culvert', Bp.x, Bp.z, { rot: Math.atan2(-nx, -nz), collide: false });
    n++;
  }
  for (let i = 0; i < Math.round(3 * K); i++) {
    const A = w.shorePoint(w.coast.estuaryU + rnd.range(-100, 100), rnd.range(0.9, 0.95));
    const Bp = w.shorePoint(w.coast.estuaryU + rnd.range(-100, 100), 0.985 + rnd() * 0.03);
    if (w.heightAt(A.x, A.z) < 0.4 || w._blocked(A.x, A.z, 1)) continue;
    w.tunnels.push({ a: A, b: Bp, kind: 'pipe', wet: true });
    prop('pipe', A.x, A.z, { collide: false });
  }
}

function shellsAndBabies(ctx) {
  const { w, rnd, K } = ctx;
  const total = Math.round(w.cfg.shells.count * K);
  const mix = [[['beach', 'dunes'], 0.3], [['headland'], 0.12], [['estuary', 'wetland'], 0.12], [['suburb', 'town'], 0.12], [['farm', 'bush', 'riverbank'], 0.14]];
  for (const [names, share] of mix) {
    let n = 0; const want = Math.round(total * share);
    for (let i = 0; i < want * 30 && n < want; i++) {
      const s = w._spotB(names, { maxSlope: 0.4, tries: 6, minW: 0.4, minH: 0.2, notRoad: false });
      if (!s || w._blocked(s.x, s.z, 0.6)) continue;
      w.shells.push({ x: s.x, z: s.z, y: w.heightAt(s.x, s.z), rot: rnd() * 6.28, got: false, kind: names[0] }); n++;
    }
  }
  // some shells lie on the sea floor in the shallows
  let n = 0; const sw = Math.round(total * 0.2);
  for (let i = 0; i < sw * 40 && n < sw; i++) {
    const x = rnd.range(-w.half + 30, w.half - 30), z = rnd.range(-w.half + 30, w.half - 30);
    const tt = w.tAt(x, z);
    if (tt < 1.0 || tt > 1.35) continue;
    const h = w.heightAt(x, z); if (h > -0.4 || h < -4) continue;
    w.shells.push({ x, z, y: h, rot: rnd() * 6.28, got: false, kind: 'sea' }); n++;
  }
  // baby octopuses: hidden in tins, big shells, rock pools and puddles (or just in the long grass). Discoverable: more of
  // them (7 per 800x800 m), a good share close to the run from the start to the sea, the rest spread over the whole world.
  const want = Math.round(7 * K);
  const spots = [];
  for (const h of w.hides) if (h.kind === 'tin' || h.kind === 'shellhide') spots.push({ x: h.x, z: h.z, kind: h.kind });
  for (const q of w.waters) if (q.kind === 'tidepool' || (q.kind === 'puddle' && rnd() < 0.1) || q.kind === 'pond' || q.kind === 'trough') spots.push({ x: q.x, z: q.z, kind: q.kind === 'tidepool' ? 'tidepool' : 'puddle' });
  spots.sort(() => rnd() - 0.5);
  // the corridor: lateral distance from the start-to-sea line, and progress along it
  const corridor = (s) => { const t = w.progress(s.x, s.z); return Math.abs(w.lateral(s.x, s.z) - w.lateral(w.start.x, w.start.z)) < 170 && t > 0.0 && t < 0.97; };
  const used = [];
  const take = (s, gap) => {
    if (Math.hypot(s.x - w.start.x, s.z - w.start.z) < 30) return false;
    if (used.some((u) => Math.hypot(u.x - s.x, u.z - s.z) < gap)) return false;
    used.push(s); w.babies.push({ id: w.babies.length, x: s.x, z: s.z, y: w.heightAt(s.x, s.z), kind: s.kind, found: false }); return true;
  };
  // a few close to where the octopus starts, so the first rescue comes early
  const close = (s) => Math.hypot(s.x - w.start.x, s.z - w.start.z) < 230;
  for (const s of spots) { if (w.babies.length >= 3) break; if (close(s)) take(s, 45); }
  for (let i = 0; i < 600 && w.babies.length < 4; i++) {
    const s = w._spotB(['farm', 'bush', 'riverbank', 'suburb', 'wetland'], { maxSlope: 0.3, tries: 6, minW: 0.4, minH: 0.3, notRoad: true });
    if (s && close(s) && !w._blocked(s.x, s.z, 0.6)) take({ x: s.x, z: s.z, kind: 'grass' }, 45);
  }
  const onPath = Math.round(want * 0.55);
  for (const s of spots) { if (w.babies.length >= onPath) break; if (corridor(s)) take(s, 45); }
  // top up the corridor with babies in the long grass / reeds if there were too few hides and pools along it
  for (let i = 0; i < 400 && w.babies.length < onPath; i++) {
    const s = w._spotB(['farm', 'bush', 'riverbank', 'suburb', 'wetland', 'dunes', 'beach'], { maxSlope: 0.3, tries: 6, minW: 0.4, minH: 0.3, notRoad: true });
    if (s && corridor(s) && !w._blocked(s.x, s.z, 0.6)) take({ x: s.x, z: s.z, kind: 'grass' }, 45);
  }
  for (const s of spots) { if (w.babies.length >= want) break; take(s, 60); }
  for (let i = 0; i < 800 && w.babies.length < want; i++) {
    const s = w._spotB(['farm', 'bush', 'riverbank', 'wetland', 'dunes', 'beach', 'headland'], { maxSlope: 0.3, tries: 6, minW: 0.4, minH: 0.3, notRoad: true });
    if (s && !w._blocked(s.x, s.z, 0.6)) take({ x: s.x, z: s.z, kind: 'grass' }, 60);
  }
}

function dew(ctx) {
  const { w, rnd, K } = ctx;
  let n = 0;
  const want = Math.round(60 * K);
  for (let i = 0; i < want * 30 && n < want; i++) {
    const s = w._spotB(['suburb', 'farm', 'bush'], { maxSlope: 0.2, tries: 5, minW: 0.5, minH: 0.8 });
    if (!s) continue;
    const tp = w.baseType(s.x, s.z);
    if (tp !== 'lawn' && tp !== 'grass' && tp !== 'pasture' && tp !== 'litter') continue;
    if (w._blocked(s.x, s.z, 0.5)) continue;
    w.seasonal.push({ kind: 'dew', gate: 'dew', x: s.x, z: s.z, r: rnd.range(2.2, 3.4) }); n++;
  }
}
