// =====================================================================
//  Regions - the land never ends. The original map is the square [-800, 800]^2 (generated all at once in areas.js). Everything
//  outside it is generated lazily, one 400 x 400 m tile at a time, as the octopus gets near, deterministically from
//  (seed, tile x, tile z): the same tile always comes out identical, whatever order tiles are visited in.
//
//  What a far tile holds: the natural landscape only (no streets, houses or landmarks): trees, rocks, grass, flowers, puddles /
//  ponds / dams / rock pools, reeds, beach bits, seagrass and reef, hide-aways (shell hides, slabs, hollow logs), collectible
//  shells and baby octopuses. Biomes continue analytically (coast stretches repeat along the shore forever; inland the
//  farm / bush patchwork goes on).
//
//  Far inland (away from the ocean) the land turns harsher, silently: WorldData.harshAt() drives fewer puddles, fewer trees,
//  drier grass and no flowers; the octopus dries faster, the haze warms and more eagles circle (see game / atmosphere / predators).
//
//  Determinism / seams: a tile only places things inside its own rectangle (plus a 30 m skirt on the sides that touch the
//  original map, for non-carving items), and carved water is kept far enough from tile edges that it never changes the terrain of
//  a neighbour. A tile is generated before any chunk covering it is built, so the frozen terrain grid is always consistent.
// =====================================================================
import { mulberry32 } from '../util/rng.js';
import { BIOMES } from './biomes.js';
import { scatterGather } from './gather.js';
import { TREE_RULES, TREE_SCALE, GRASS_SCALE, PROP_SCALE } from './areas.js';

export const REGION = 400;      // tile size (m); a multiple of the view chunk size (100)
const SKIRT = 30;

export class Regions {
  constructor(world) {
    this.w = world;
    this.n0 = Math.round(world.cfg.worldSize / REGION);   // the original map is tiles 0 .. n0-1 on both axes
    this.map = new Map();
    this.listeners = [];
    this.list = [];
  }
  key(rx, rz) { return rz * 100003 + rx; }
  tileOf(x, z) { return [Math.floor((x + this.w.half) / REGION), Math.floor((z + this.w.half) / REGION)]; }
  isOriginal(rx, rz) { return rx >= 0 && rz >= 0 && rx < this.n0 && rz < this.n0; }
  get(rx, rz) { return this.map.get(this.key(rx, rz)) || null; }
  onGenerate(fn) { this.listeners.push(fn); for (const r of this.list) fn(r); }

  /** make sure every far tile within r metres of (x, z) exists (at most `max` new tiles per call); returns the number generated */
  ensure(x, z, r, max = 1e9) {
    const h = this.w.half;
    const x0 = Math.floor((x - r + h) / REGION), x1 = Math.floor((x + r + h) / REGION);
    const z0 = Math.floor((z - r + h) / REGION), z1 = Math.floor((z + r + h) / REGION);
    let made = 0;
    const need = [];
    for (let rz = z0; rz <= z1; rz++) for (let rx = x0; rx <= x1; rx++) {
      if (this.isOriginal(rx, rz) || this.map.has(this.key(rx, rz))) continue;
      const cx = -h + (rx + 0.5) * REGION, cz = -h + (rz + 0.5) * REGION;
      const d = Math.max(0, Math.abs(cx - x) - REGION / 2) ** 2 + Math.max(0, Math.abs(cz - z) - REGION / 2) ** 2;
      if (d <= r * r) need.push({ rx, rz, d });
    }
    need.sort((a, b) => a.d - b.d);
    for (const t of need) { if (made >= max) break; this.generate(t.rx, t.rz); made++; }
    return made;
  }

  /** generate tile (rx, rz) now (idempotent) */
  generate(rx, rz) {
    const old = this.get(rx, rz); if (old) return old;
    const w = this.w, h = w.half;
    const x0 = -h + rx * REGION, z0 = -h + rz * REGION;
    const rect = { x0, x1: x0 + REGION, z0, z1: z0 + REGION };                 // carving things stay inside this
    const sk = { x0, x1: rect.x1, z0, z1: rect.z1 };                           // non-carving things may use a skirt over the original map
    if (rx === this.n0) sk.x0 -= SKIRT; if (rx === -1) sk.x1 += SKIRT; if (rz === this.n0) sk.z0 -= SKIRT; if (rz === -1) sk.z1 += SKIRT;
    const rnd = mulberry32((w.seed ^ Math.imul(rx + 7919, 0x9e3779b1) ^ Math.imul(rz + 104729, 0x85ebca6b)) >>> 0);
    for (let i = 0; i < 4; i++) rnd();
    const reg = { rx, rz, rect, decor: { trees: [], rocks: [], grass: [], flowers: [], beach: [], reeds: [], seagrass: [], reef: [] }, props: [], waters: [], shells: [], babies: [], hides: [], gather: [], harsh: 0 };
    const cx = x0 + REGION / 2, cz = z0 + REGION / 2;
    reg.harsh = w.harshAt(cx, cz);
    const ctx = { w, rnd, reg, rect, sk, K: (REGION * REGION) / 640000, H: reg.harsh, G: w.cfg.graphics, W: w.cfg.water };
    this.map.set(this.key(rx, rz), reg); this.list.push(reg);
    water(ctx); trees(ctx); rocks(ctx); ground(ctx); reeds(ctx); coast(ctx); sea(ctx); hides(ctx); shellsAndBabies(ctx);
    // gatherables: their own random stream per tile (so they never move the rest of the tile)
    const gr = mulberry32((w.seed ^ Math.imul(rx + 31, 0x27d4eb2f) ^ Math.imul(rz + 57, 0x165667b1)) >>> 0);
    reg.gather = scatterGather(w, gr, { rect: { x0: rect.x0 + 2, x1: rect.x1 - 2, z0: rect.z0 + 2, z1: rect.z1 - 2 }, K: ctx.K, decor: reg.decor, waters: reg.waters, prefix: `r${rx}_${rz}_` });
    for (const g of reg.gather) w.gather.push(g);
    for (const fn of this.listeners) fn(reg);
    return reg;
  }
}

const dom = (w, x, z) => { const q = w.biomes.weights(x, z); let id = 0; for (let i = 1; i < q.length; i++) if (q[i] > q[id]) id = i; return BIOMES[id]; };
const inRect = (r, x, z, m = 0) => x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m;
const pt = (rnd, r, m = 0) => [rnd.range(r.x0 + m, r.x1 - m), rnd.range(r.z0 + m, r.z1 - m)];
/** thin things out far inland (harsh land): keep a point with probability 1 - amount * harshness there */
const keep = (ctx, x, z, amount) => ctx.rnd() >= amount * ctx.w.harshAt(x, z);

// ---------------------------------------------------------------- water (carved first: nothing else is placed before it)
function water(ctx) {
  const { w, rnd, reg, rect, K, W, H } = ctx;
  const accept = { suburb: 1, town: 0.8, farm: 0.8, bush: 0.7, riverbank: 0.4, wetland: 0.05, dunes: 0.12, beach: 0.06, headland: 0.3, estuary: 0.05, sea: 0 };
  const thin = 1 - 0.85 * H;                                                     // far inland: far fewer puddles
  const put = (kind, count, names, rr, opts = {}) => {
    const want = Math.round(count * thin * (opts.thin ? 1 : 1));
    const inset = rr[1] * 1.8 + 3;                                              // carve reach (1.7 r) stays inside the tile
    const area = { x0: rect.x0 + inset, x1: rect.x1 - inset, z0: rect.z0 + inset, z1: rect.z1 - inset };
    let made = 0;
    for (let i = 0; i < want * 40 && made < want; i++) {
      const s = w._spotB(names, { maxSlope: opts.maxSlope ?? 0.1, slopeR: rr[1], minH: opts.minH ?? 1.0, minW: opts.minW ?? 0.55, rnd, rect: area, tries: 8 });
      if (!s) continue;
      if (opts.zone && rnd() > (accept[dom(w, s.x, s.z)] ?? 0.5)) continue;
      if (!w._farFromWater(s.x, s.z, opts.spacing ?? 14)) continue;
      const r = rnd.range(rr[0], rr[1]);
      if (w.typeAt(s.x, s.z) === 'road') continue;
      if (opts.spread !== undefined && w._ringStats(s.x, s.z, r).spread > opts.spread) continue;
      reg.waters.push(w._addWater(kind, s.x, s.z, r, { depth: opts.depth ?? 0.1 }));
      made++;
    }
  };
  const ALL = ['farm', 'bush', 'riverbank', 'headland'];
  put('puddle', Math.round(W.puddleCount * K), ALL, [2.6, 4.4], { zone: true, spacing: 16, minW: 0.5, maxSlope: 0.05, spread: 0.2 });
  put('dam', Math.round(2 * K), ['farm'], [9, 13], { spacing: 60, depth: 0.4, maxSlope: 0.04, spread: 0.7 });
  put('pond', Math.round((W.pondCount ?? 6) * K * 0.5), ['bush', 'riverbank'], [5, 8], { spacing: 40, depth: 0.35, maxSlope: 0.06, spread: 0.4 });
  put('pond', Math.round(10 * K), ['wetland'], [4, 8], { spacing: 18, depth: 0.3, maxSlope: 0.07, spread: 0.4, minH: 0.5, minW: 0.5 });
  put('tidepool', Math.round(W.tidepoolCount * K * 0.8), ['headland'], [2.6, 4.4], { spacing: 12, minH: 0.2, maxSlope: 0.1, spread: 0.3, depth: 0.2, minW: 0.3 });
  put('tidepool', Math.round(W.tidepoolCount * K * 0.15), ['beach', 'estuary'], [2.2, 3.4], { spacing: 25, minH: 0.2, maxSlope: 0.08, spread: 0.3, depth: 0.2, minW: 0.3 });
}

// ---------------------------------------------------------------- trees, rocks, ground cover
function trees(ctx) {
  const { w, rnd, reg, sk, K, G } = ctx;
  const target = Math.round(G.treeCount * K);
  const out = reg.decor.trees; let tries = 0;
  while (out.length < target && tries++ < target * 22) {
    const [x, z] = pt(rnd, sk, 4);
    const b = dom(w, x, z), rule = TREE_RULES[b];
    if (!rule || rnd() > rule.p || !keep(ctx, x, z, 0.6)) continue;
    const tw = w.tAt(x, z);
    let kind = null, r = rnd(), acc = 0;
    for (const [k, p] of rule.kinds) { acc += p; if (r <= acc) { kind = k; break; } }
    if (!kind) continue;
    if (b === 'wetland') kind = tw > 0.84 ? 'mangrove' : kind === 'mangrove' ? 'paperbark' : kind;
    if (b === 'estuary' && tw > 0.93) continue;
    if (w.isRoad(x, z, 2.2) || w._blocked(x, z, 1.2)) continue;
    const hh = w.heightAt(x, z);
    if (hh < (kind === 'mangrove' ? 0.12 : 0.9)) continue;
    const scale = (kind === 'bush' ? rnd.range(0.7, 1.4) : kind === 'gum' ? rnd.range(1.0, 1.8) : rnd.range(0.8, 1.7)) * (kind === 'bush' ? 1.3 : TREE_SCALE);
    out.push({ x, z, y: hh, kind, scale, rot: rnd() * 6.28, tint: rnd.range(0.82, 1.1) });
    if (kind !== 'bush') w._addCircle(x, z, (kind === 'mangrove' ? 0.7 : 0.5) * scale, { kind: 'tree' });
  }
}
function rocks(ctx) {
  const { w, rnd, reg, sk, K, G } = ctx;
  const target = Math.round(G.rockCount * K);
  const P = { suburb: 0.002, town: 0, farm: 0.02, bush: 0.07, riverbank: 0.15, wetland: 0, dunes: 0.01, beach: 0.02, headland: 0.5, estuary: 0.01 };
  let tries = 0, n = 0;
  while (n < target && tries++ < target * 40) {
    const [x, z] = pt(rnd, sk, 4);
    const b = dom(w, x, z);
    let p = P[b] ?? 0;
    if (b === 'bush' && w.baseType(x, z) === 'rock') p = 0.5;
    if (b === 'headland' && w.tAt(x, z) > 0.96) p = 0.12;
    if (rnd() > p) continue;
    if (w._blocked(x, z, 1) || w.isRoad(x, z, 1)) continue;
    const hh = w.heightAt(x, z);
    if (hh < 0.7) continue;
    const size = rnd() < (b === 'headland' ? 0.25 : 0.12) ? rnd.range(2.2, 4) : rnd.range(0.5, 1.8);
    reg.decor.rocks.push({ x, z, y: hh, size, rot: rnd() * 6.28, sy: rnd.range(0.55, 1.0), tint: rnd.range(0.8, 1.1), dark: b === 'headland' });
    w._addCircle(x, z, size * 0.85, { kind: 'rock' });
    n++;
  }
}
function ground(ctx) {
  const { w, rnd, reg, sk, K, G } = ctx;
  const grass = reg.decor.grass, flowers = reg.decor.flowers;
  const P = { lawn: 0.9, grass: 1, pasture: 1, litter: 0.38, scrub: 0.5, dunegrass: 0.8, dune: 0.15, swamp: 0.3, mud: 0.12, bank: 0.4, gravel: 0.05, forest: 0.6, headland: 0.1, rock: 0.04 };
  let tries = 0;
  const gt = Math.round(G.grassCount * K);
  while (grass.length < gt && tries++ < gt * 8) {
    const [x, z] = pt(rnd, sk, 2);
    const tp = w.baseType(x, z);
    if (rnd() > (P[tp] ?? 0) || !keep(ctx, x, z, 0.35)) continue;
    if (w.isRoad(x, z, 1)) continue;
    const hh = w.heightAt(x, z);
    if (hh < 0.9) continue;
    const harsh = w.harshAt(x, z);
    const dry = tp === 'scrub' || tp === 'dune' || tp === 'dunegrass' || tp === 'pasture' && rnd() < 0.4 || tp === 'litter' || rnd() < harsh * 0.85;
    grass.push({ x, z, y: hh, s: rnd.range(0.7, 1.5) * GRASS_SCALE * (tp === 'dune' || tp === 'dunegrass' ? 1.4 : 1), rot: rnd() * 6.28, dry, tint: rnd.range(0.8, 1.15), wet: tp === 'swamp' });
  }
  tries = 0;
  const ft = Math.round(G.flowerCount * K);
  while (flowers.length < ft && tries++ < ft * 12) {
    const [x, z] = pt(rnd, sk, 2);
    const tp = w.baseType(x, z);
    if (tp !== 'lawn' && tp !== 'grass' && tp !== 'pasture' && !(tp === 'litter' && rnd() < 0.3)) continue;
    if (!keep(ctx, x, z, 0.95)) continue;                                      // flowers vanish in the harsh far inland
    const hh = w.heightAt(x, z);
    if (hh < 1 || w.isRoad(x, z, 1)) continue;
    flowers.push({ x, z, y: hh, color: rnd.pick(tp === 'litter' ? [0xffe066, 0xffffff, 0xd96a3a] : [0xffe066, 0xff8fa3, 0xffffff, 0xc77dff, 0xff9f45]), s: rnd.range(0.7, 1.2) });
  }
}
function reeds(ctx) {
  const { w, rnd, reg } = ctx;
  for (const q of reg.waters) {
    if (q.kind === 'tidepool' || q.kind === 'dam' && rnd() < 0.3) continue;
    const n = q.kind === 'pond' || q.kind === 'dam' ? 12 : 3;
    for (let i = 0; i < n; i++) {
      const a = rnd() * 6.28, d = q.r * rnd.range(1.0, 1.35);
      const x = q.x + Math.cos(a) * d, z = q.z + Math.sin(a) * d;
      const tp = w.baseType(x, z);
      if (tp === 'road' || tp === 'sand' || tp === 'dune' || tp === 'wet' || tp === 'paving' || tp === 'rock') continue;
      reg.decor.reeds.push({ x, z, y: w.heightAt(x, z), s: rnd.range(0.8, 1.6), rot: rnd() * 6.28 });
    }
  }
}

// ---------------------------------------------------------------- the coast (extends forever along the shore) and the sea floor
function coast(ctx) {
  const { w, rnd, reg, sk, K } = ctx;
  const target = Math.round(220 * K);
  for (let i = 0; i < target * 12 && reg.decor.beach.length < target; i++) {
    const [x, z] = pt(rnd, sk, 4);
    const tt = w.tAt(x, z);
    if (tt < 0.88 || tt > 1.0) { if (tt < 0.8 || tt > 1.05) i += 8; continue; }
    const b = dom(w, x, z);
    if (b !== 'beach' && b !== 'estuary' && b !== 'headland' && b !== 'dunes' && b !== 'wetland') continue;
    const hh = w.heightAt(x, z);
    if (hh < 0.05) continue;
    reg.decor.beach.push({ x, z, y: hh, kind: rnd.pick(['shell', 'shell', 'weed', 'weed', 'wood']), rot: rnd() * 6.28, s: rnd.range(0.7, 1.4) });
  }
}
function sea(ctx) {
  const { w, rnd, reg, sk, K } = ctx;
  const sg = reg.decor.seagrass, reef = reg.decor.reef;
  const tg = Math.round(2400 * K), tr = Math.round(260 * K);
  for (let tries = 0; (sg.length < tg || reef.length < tr) && tries < (tg + tr) * 12; tries++) {
    const [x, z] = pt(rnd, sk, 4);
    const tt = w.tAt(x, z);
    if (tt < 1.01 || tt > 1.7) { if (tt < 0.9 || tt > 1.8) tries += 20; continue; }
    const hh = w.heightAt(x, z);
    if (hh > -0.5 || hh < -6.5) continue;
    const kinds = w.biomes.coastKinds(w.lateral(x, z));
    if (sg.length < tg && hh > -4.5 && (kinds[1] + kinds[3] + kinds[0] * 0.7) * w.n.fbm(x * 0.03, z * 0.03, 2) > 0.1) sg.push({ x, z, y: hh, s: rnd.range(0.8, 1.6), rot: rnd() * 6.28 });
    else if (reef.length < tr && (kinds[2] * 1.4 + kinds[0] * 0.5) * (0.5 + w.n.fbm(x * 0.02 + 5, z * 0.02, 2)) > 0.4) {
      const coral = rnd() < 0.55;
      reef.push({ x, z, y: hh, kind: coral ? 'coral' : 'rock', s: coral ? rnd.range(0.7, 1.7) : rnd.range(0.8, 2.4), rot: rnd() * 6.28, hue: rnd() });
      if (!coral) w._addCircle(x, z, 0.8, { kind: 'rock' });
    }
  }
}

// ---------------------------------------------------------------- hide-aways, shells, baby octopuses
function prop(ctx, kind, x, z, o = {}) {
  const { w, reg } = ctx;
  const p = { kind, x, z, y: w.heightAt(x, z), rot: o.rot ?? 0, s: (o.s ?? 1) * (PROP_SCALE[kind] ?? 1), tint: 1 };
  w.props.push(p); reg.props.push(p); return p;
}
function hides(ctx) {
  const { w, rnd, reg, sk, K } = ctx;
  const plan = [['shellhide', ['beach', 'estuary', 'headland'], 12, 0.65], ['slab', ['headland', 'bush', 'riverbank'], 10, 0.6], ['hollowlog', ['bush', 'wetland'], 8, 0.7]];
  for (const [kind, names, count, minW] of plan) {
    let n = 0; const want = Math.round(count * K * 1);
    for (let i = 0; i < Math.max(2, want) * 25 && n < want; i++) {
      const s = w._spotB(names, { maxSlope: 0.25, tries: 10, minW: minW - 0.2, minH: 0.25, notRoad: false, rnd, rect: { x0: sk.x0 + 4, x1: sk.x1 - 4, z0: sk.z0 + 4, z1: sk.z1 - 4 } });
      if (!s || w._blocked(s.x, s.z, 1.2) || w.waterAt(s.x, s.z)) continue;
      prop(ctx, kind, s.x, s.z, { rot: rnd() * 6.28, s: kind === 'slab' ? rnd.range(1, 1.5) : 1 });
      const hd = { x: s.x, z: s.z, r: kind === 'slab' ? 1.6 : kind === 'hollowlog' ? 1.5 : 1.1, kind };
      w.hides.push(hd); reg.hides.push(hd);
      n++;
    }
  }
}
function shellsAndBabies(ctx) {
  const { w, rnd, reg, sk, K } = ctx;
  const area = { x0: sk.x0 + 4, x1: sk.x1 - 4, z0: sk.z0 + 4, z1: sk.z1 - 4 };
  const total = Math.round(w.cfg.shells.count * K);
  const mix = [[['beach', 'dunes'], 0.3], [['headland'], 0.12], [['estuary', 'wetland'], 0.12], [['farm', 'bush', 'riverbank'], 0.26]];
  const mk = (x, z, y, kind) => {
    const sh = { reg: true, id: `r${reg.rx}_${reg.rz}_s${reg.shells.length}`, x, z, y, rot: rnd() * 6.28, got: false, kind, k: ['c', 't', 'k'][Math.floor(rnd() * 3)], s: 0.85 + rnd() * 0.7 };
    w.shells.push(sh); reg.shells.push(sh); return sh;
  };
  for (const [names, share] of mix) {
    let n = 0; const want = Math.round(total * share);
    for (let i = 0; i < want * 30 && n < want; i++) {
      const s = w._spotB(names, { maxSlope: 0.4, tries: 6, minW: 0.4, minH: 0.2, notRoad: false, rnd, rect: area });
      if (!s || w._blocked(s.x, s.z, 0.6)) continue;
      mk(s.x, s.z, w.heightAt(s.x, s.z), names[0]); n++;
    }
  }
  let n = 0; const sw = Math.round(total * 0.2);
  for (let i = 0; i < sw * 40 && n < sw; i++) {
    const [x, z] = pt(rnd, area);
    const tt = w.tAt(x, z);
    if (tt < 1.0 || tt > 1.35) { if (tt < 0.9 || tt > 1.5) i += 10; continue; }
    const hh = w.heightAt(x, z); if (hh > -0.4 || hh < -4) continue;
    mk(x, z, hh, 'sea'); n++;
  }
  // baby octopuses: the same density as the original map (7 per 800 x 800 m): hide-aways, pools, puddles and long grass
  const spots = [];
  for (const h of reg.hides) if (h.kind === 'shellhide') spots.push({ x: h.x, z: h.z, kind: 'shellhide' });
  for (const q of reg.waters) if (q.kind === 'tidepool' || q.kind === 'pond' || (q.kind === 'puddle' && rnd() < 0.1)) spots.push({ x: q.x, z: q.z, kind: q.kind === 'tidepool' ? 'tidepool' : 'puddle' });
  spots.sort(() => rnd() - 0.5);
  const want = Math.floor(7 * K + rnd());
  const used = [];
  const take = (s) => {
    if (used.some((u) => Math.hypot(u.x - s.x, u.z - s.z) < 60)) return;
    used.push(s);
    const b = { id: `r${reg.rx}_${reg.rz}_${used.length}`, x: s.x, z: s.z, y: w.heightAt(s.x, s.z), kind: s.kind, found: false };
    w.babies.push(b); reg.babies.push(b);
  };
  for (const s of spots) { if (used.length >= want) break; take(s); }
  for (let i = 0; i < 300 && used.length < want; i++) {
    const s = w._spotB(['farm', 'bush', 'riverbank', 'wetland', 'dunes', 'beach', 'headland'], { maxSlope: 0.3, tries: 6, minW: 0.4, minH: 0.3, notRoad: true, rnd, rect: area });
    if (s && !w._blocked(s.x, s.z, 0.6)) take({ x: s.x, z: s.z, kind: 'grass' });
  }
}
void inRect;
