// =====================================================================
//  WorldData - the pure (no three.js) description of one generated world:
//  terrain height, terrain type, biomes, water sources, colliders and decoration spots.
//  Everything is derived from a seed so a world can be reproduced exactly (daily seed!).
//  Biome logic lives in biomes.js, the placement of each biome's props in areas.js.
// =====================================================================
import { Regions } from './regions.js';
import { CONFIG } from '../config.js';
import { makeNoise } from '../util/noise.js';
import { mulberry32, clamp, lerp, smoothstep } from '../util/rng.js';
import { BiomeField, B, BIOMES, COAST_KINDS, bandZw } from './biomes.js';
import { placeAreas } from './areas.js';
import { scatterGather } from './gather.js';
import { SHORE_Z, SPAN, EDGE, WALL, bandOfZ, ISLETS, ROCK } from './bands.js';

const ss = smoothstep;
void WALL;

export class Hash {
  constructor(cell = 16) { this.cell = cell; this.map = new Map(); }
  key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  add(x, z, reach, item) {
    const c = this.cell;
    const x0 = Math.floor((x - reach) / c), x1 = Math.floor((x + reach) / c);
    const z0 = Math.floor((z - reach) / c), z1 = Math.floor((z + reach) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this.key(ix, iz);
      let a = this.map.get(k);
      if (!a) { a = []; this.map.set(k, a); }
      a.push(item);
    }
  }
  at(x, z) { return this.map.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) || EMPTY; }
}
const EMPTY = [];

/** 1 inside a house lot, falling smoothly to 0 across `blend` metres (chebyshev, so the corners stay level too) */
function housePadWeight(p, x, z) {
  const dx = x > p.x ? x - p.x : p.x - x;
  let ax = 0;
  if (dx > p.hx) { ax = (dx - p.hx) / p.blend; if (ax >= 1) return 0; }
  let az = 0;
  if (z < p.z0) { az = (p.z0 - z) / p.blend; if (az >= 1) return 0; }
  else if (z > p.z1) { az = (z - p.z1) / p.blend; if (az >= 1) return 0; }
  const t = ax > az ? ax : az;
  if (t <= 0) return 1;
  const u = 1 - t;
  return u * u * (3 - 2 * u);
}

const STILL = new Set(['puddle', 'dam', 'pond', 'tidepool', 'drip', 'aircon', 'trough', 'sludge']);


export class WorldData {
  constructor(seed = Math.floor(Math.random() * 1e9), cfg = CONFIG) {
    this.cfg = cfg;
    this.seed = seed >>> 0;
    this.rnd = mulberry32(this.seed ^ 0x9e3779b9);
    this.n = makeNoise(this.seed);
    this.half = cfg.worldSize / 2;
    this.areaScale = (cfg.worldSize / 800) ** 2;      // all "counts" in CONFIG are per 800 x 800 m, so density stays the same on bigger maps

    // --- the banded world (bands.js): the sea is always to the south (+z), the bands climb north to the ranges ---------
    this.rnd();                                                         // (kept: the old random sea angle, so the rest of the stream is unchanged)
    this.banded = true;
    this.angle = Math.PI / 2;
    this.dir = { x: 0, z: 1 };                                          // points TOWARDS the sea
    this.perp = { x: -this.dir.z, z: this.dir.x };                     // along the shoreline
    this.cStart = SHORE_Z - SPAN;
    this.cCoast = SHORE_Z;
    this.edge = EDGE;
    this.roadOff = { x: this.rnd() * 90, z: this.rnd() * 90 };

    this.carveHash = new Hash(16);
    this.padHash = new Hash(16);   // levelled house lots (see addHousePad)
    this.waterHash = new Hash(16);
    this.colHash = new Hash(12);
    this.centreHash = new Hash(32);
    this.creekHash = new Hash(24);
    this.waters = [];        // every static water source: {kind,x,z,r,H,carve}
    this.rain = [];          // moving rain clouds: {x,z,r,vx,vz}
    this.temp = [];          // temporary storm puddles (Environment adds / removes them)
    this.seasonal = [];      // sources that only exist at certain times: {kind,gate,x,z,r}
    this.gates = { dew: 0, wet: 0 };
    this.dryMult = 1; this.night = 0; this.weatherKind = 'clear'; this.gust = 0; this.raining = false;
    this.seaLevel = 0;       // tide: the Environment moves this a little (+-0.5) over time
    this.houses = [];
    this.pads = [];          // {x,z,H,hx,z0,z1,blend} flat lots under houses, blended at the edge
    this.taps = [];          // visual props for drips / seeps / sprinklers / aircon
    this.sprinklers = [];
    this.colliders = [];     // circles {x,z,r} and boxes {x,z,hw,hd}  (+ optional climb/h/kind)
    this.props = [];         // visual props {kind,x,z,y,rot,s,...} (instanced per chunk by the view)
    this.hides = [];         // hiding places {x,z,r,kind}
    this.tunnels = [];       // squeeze-through gaps {a:{x,z},b:{x,z},kind,wet}
    this.shells = [];        // hidden collectible shells {x,z,y,got}
    this.babies = [];        // baby octopuses to rescue {id,x,z,y,kind,found}
    this.landmarks = [];     // {kind,x,z}
    this.gather = [];        // gatherable items {id,kind,x,z,y,rot,s} (see gather.js); far regions append theirs
    this.creek = [];         // creek centre-line nodes (every ~2.4 m)
    this.coast = null;

    this.regions = new Regions(this);
    this._makeCoast();
    this._makeCreek();
    this.biomes = new BiomeField(this);
    this._placeStart();
    this._placeWater();
    this.freezeTerrain();                 // everything below is placed on the exact terrain mesh
    placeAreas(this);
    // gatherables (crabs, kelp, pebbles ...): their own random stream, so adding / tuning them never moves anything else
    const gr = mulberry32((seed ^ 0x6a7e51) >>> 0), e = 30;
    this.gather = scatterGather(this, gr, { rect: { x0: -this.half + e, x1: this.half - e, z0: -this.half + e, z1: this.half - e }, K: this.areaScale, decor: this.decor, waters: this.waters, prefix: 'o' });
  }

  // ---------------- coordinates ----------------------------------------------------
  /** 0 at the start line, 1 at the shoreline (not warped). */
  progress(x, z) { return (x * this.dir.x + z * this.dir.z - this.cStart) / (this.cCoast - this.cStart); }
  /** metres along the shoreline (perpendicular to the sea direction) */
  lateral(x, z) { return x * this.perp.x + z * this.perp.z; }
  /** progress with an irregular coastline / biome borders. */
  tAt(x, z) {
    const n = this.n;
    const w = n.fbm(x * 0.0055 + 311, z * 0.0055 - 77, 3) * 0.04 + n.fbm(x * 0.0016 + 9, z * 0.0016 - 3, 2) * 0.03;
    const j = n.noise2(x * 0.04, z * 0.04) * 0.008;
    return this.progress(x, z) + w + j + this.shoreShift(x) / SPAN;
  }
  /**
   * metres the waterline moves inland (north, +) or out to sea (south, −).
   * A headland on the west, a sandy bay in the middle, a cove to the east — not one straight beach.
   */
  shoreShift(x) {
    const ss = smoothstep;
    const head = ss(-560, -400, x) * (1 - ss(-340, -200, x));
    const bay = ss(-210, -70, x) * (1 - ss(50, 190, x));
    const cove = ss(170, 270, x) * (1 - ss(390, 510, x));
    return -46 * head + 38 * bay + 26 * cove + 14 * Math.sin(x * 0.009 + 0.45);
  }
  /** meters from the shoreline along the sea direction (negative = on land) */
  distToSea(x, z) { return (this.tAt(x, z) - 1.0) * (this.cCoast - this.cStart); }
  get span() { return this.cCoast - this.cStart; }
  /** point on the (unwarped) shoreline at lateral position u */
  shorePoint(u, tt = 1) {
    const c = this.cStart + tt * this.span;
    return { x: this.dir.x * c + this.perp.x * u, z: this.dir.z * c + this.perp.z * u };
  }

  /** 0 by the sea and in the suburbs, rising through the outback to 0.6 in the wasteland: the land gets drier and harsher, silently */
  harshAt(x, z) {
    const t = this.progress(x, z);
    return 0.45 * ss(0.0, -0.3, t) + 0.15 * ss(-0.3, -0.45, t);
  }
  /** the band (bands.js index: 0 sea .. 5 wasteland) at x,z, using the same wandering borders as the biomes */
  bandAt(x, z) {
    if (this.tAt(x, z) > 1.0) return 0;
    const zw = bandZw(this.n, x, z);
    if (this.tAt(x, z) > 0.81) return 1;
    return Math.max(2, bandOfZ(zw));
  }
  /** metres past the inner edge of the land (west, east and north ranges); negative inside */
  edgeOut(x, z) { return Math.max(EDGE.west - x, x - EDGE.east, EDGE.north - z); }
  /** the soft wall: where the octopus (or anything that walks) may be. Past WALL metres up the foothills, or past the outer sea, it is held back. */
  clampToBounds(x, z, out = { x, z, hit: false }) {
    out.x = x; out.z = z; out.hit = false;
    if (!this.banded) return out;
    const lo = EDGE.west - WALL, hi = EDGE.east + WALL, top = EDGE.north - WALL;
    if (out.x < lo) { out.x = lo; out.hit = true; } else if (out.x > hi) { out.x = hi; out.hit = true; }
    if (out.z < top) { out.z = top; out.hit = true; } else if (out.z > EDGE.sea) { out.z = EDGE.sea; out.hit = true; }
    return out;
  }
  /** the big shell in the shallows where every game begins (the future Octo house) */
  get shell() { return this._shell; }

  // ---------------- coast stretches & the creek (decided first: no heights needed) -----------------
  _makeCoast() {
    const rnd = this.rnd;
    for (let i = 0; i < 5; i++) rnd();                                 // (the old random stretch widths: keep the stream in step)
    // one fixed shore, west to east: rocky headland | beach with dunes behind (the start) | river mouth + jetty | mangroves.
    // lateral u = -x, so the stretches run east to west in u.
    const segs = [{ kind: 1, a: -6000, b: -300 }, { kind: 3, a: -300, b: -110 }, { kind: 0, a: -110, b: 330 }, { kind: 2, a: 330, b: 6000 }];
    this.coast = { segments: segs, period: 1e6, shift: 0, estuaryU: -205, kinds: COAST_KINDS };
  }
  /** which stretch of coast is at lateral u: index into COAST_KINDS (dominant) */
  coastKindAt(u) { return this.biomes.coastKinds(u).reduce((best, v, i, arr) => (v > arr[best] ? i : best), 0); }
  /** lateral centre of the nearest stretch of the given kind (for tests / landmark placement) */
  coastCentre(kindName, near = 0) {
    const k = COAST_KINDS.indexOf(kindName), c = this.coast;
    let best = null;
    for (const s of c.segments) if (s.kind === k) for (const off of [-c.period, 0, c.period]) {
      const a = this.banded ? Math.max(s.a, -(EDGE.east - 50)) : s.a, b = this.banded ? Math.min(s.b, EDGE.east - 50) : s.b;   // (banded: the part of the stretch inside the ranges)
      const m = (a + b) / 2 + off + c.shift;
      if (best === null || Math.abs(m - near) < Math.abs(best - near)) best = m;
    }
    return best;
  }

  _makeCreek() {
    const rnd = this.rnd;
    const E = this.shorePoint(this.coast.estuaryU, 0.985);
    const mk = (S, T, amp, steps0) => {
      const len = Math.hypot(T.x - S.x, T.z - S.z) * 1.12;
      const steps = Math.max(8, Math.floor(len / 2.4));
      const p1 = rnd() * 6.28, p2 = rnd() * 6.28, f1 = rnd.range(6, 10), f2 = rnd.range(14, 20);
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const s = i / steps, env = Math.pow(Math.sin(Math.PI * Math.min(1, s * 0.98 + 0.01)), 0.6);
        const m = amp * (Math.sin(s * f1 + p1) * 0.65 + Math.sin(s * f2 + p2) * 0.35) * env;
        pts.push({ x: lerp(S.x, T.x, s) + this.perp.x * m, z: lerp(S.z, T.z, s) + this.perp.z * m, s });
      }
      return pts;
    };
    // the river rises at the foot of the northern ranges and winds south through every band to the estuary
    const S = { x: 40 + rnd.range(-30, 30), z: EDGE.north + 40 };
    const main = mk(S, E, 68);
    // a tributary from the bush wetland that joins the main river out in the farmland
    const j = main[Math.floor(main.length * 0.62)];
    rnd();
    const S2 = { x: -230, z: -150 };
    const trib = mk(S2, j, 30);
    this.creek = main; this.creekTrib = trib;
    for (const list of [main, trib]) list.forEach((p, i) => { if (i % 3 === 0) this.creekHash.add(p.x, p.z, 26, p); });
  }
  /** metres to the nearest creek centre line (1e9 when far) */
  creekDist(x, z) {
    const list = this.creekHash.at(x, z);
    let best = 1e9;
    for (let i = 0; i < list.length; i++) { const p = list[i]; const d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z); if (d < best) best = d; }
    return best > 1e8 ? 1e9 : Math.sqrt(best);
  }
  /** creek progress s (0 source .. 1 mouth) at the nearest node (only valid when close) */
  creekS(x, z) {
    const list = this.creekHash.at(x, z); let best = 1e9, s = 0;
    for (const p of list) { const d = (x - p.x) ** 2 + (z - p.z) ** 2; if (d < best) { best = d; s = p.s; } }
    return s;
  }

  // ---------------- terrain height -------------------------------------------------
  /** terrain before water carving */
  baseHeight(x, z) {
    const n = this.n;
    const w = this.biomes.weights(x, z);
    const tw = this.tAt(x, z);
    const u = this.lateral(x, z);
    const hills = ss(0.46, 0.6, tw);
    const amp = w[B.suburb] * 0.8 + w[B.town] * 0.45 + w[B.farm] * 1.9 + w[B.bush] * (3.4 + 5.2 * hills) + w[B.riverbank] * 1.6 +
      w[B.wetland] * 0.5 + w[B.dunes] * 2.4 + w[B.beach] * 0.9 + w[B.headland] * 7.5 + w[B.estuary] * 0.3 + w[B.sea] * 0.8 + w[B.desert] * 1.6 + w[B.rainforest] * (3.4 + 5.2 * hills) + w[B.mudflat] * 0.22 + w[B.wasteland] * 1.1;   // a rainforest gully keeps the bush hills' shape
    const low = w[B.wetland] + w[B.estuary] + w[B.mudflat] * 0.9;
    const cd = this.creekDist(x, z);
    // (the fine ground ripple is ironed out along the creek bed, so the water surface never hangs over a bump)
    let h = lerp(2.3, 1.1, low) + amp * (n.fbm(x * 0.011, z * 0.011, 4) + 1) * 0.95 + 0.22 * n.noise2(x * 0.13, z * 0.13) * (1 - low * 0.6) * (cd < 14 ? 0.25 + 0.75 * ss(3, 14, cd) : 1);
    // creek valley: the banks slope gently down to the water
    if (cd < 30) h -= 0.5 * (1 - ss(5, 30, cd)) * (1 - low);
    // ---- the shore: each stretch of coast has its own profile ------------------------------
    const coast = ss(0.76, 0.82, tw);
    if (coast > 0) {
      const ck = this.biomes.coastKinds(u);
      // beach (+ dunes behind): ridges, then a gentle slope into the sea
      let hb = h + ss(0.8, 0.84, tw) * (1 - ss(0.88, 0.95, tw)) * 3.0 * Math.pow(1 - Math.abs(n.noise2(x * 0.028 + 5, z * 0.028 - 9)), 2);
      hb = lerp(hb, 1.5 - 15 * (tw - 0.9), ss(0.84, 0.95, tw));
      // mangrove wetland: low, flat, muddy; shallow for a long way
      let hm = lerp(h, 0.75 - 4 * (tw - 0.9) + 0.1 * n.noise2(x * 0.2, z * 0.2), ss(0.8, 0.9, tw)) - 14 * ss(1.05, 1.3, tw);
      // headland: high ground, a cliff, a rocky shelf with pools, then deep water
      let hh = lerp(h, 0.55 + 0.35 * n.noise2(x * 0.09, z * 0.09), ss(0.9, 0.972, tw)) - 55 * ss(1.0, 1.1, tw) * 0.2 - 10 * ss(1.02, 1.2, tw);
      hh += ss(0.8, 0.85, tw) * (1 - ss(0.9, 0.95, tw)) * 1.5;
      // estuary: wide mudflats and channels
      let he = lerp(h, 0.5 - 3 * (tw - 0.9) + 0.08 * n.noise2(x * 0.15, z * 0.15), ss(0.82, 0.9, tw)) - 12 * ss(1.06, 1.3, tw);
      const hc = ck[0] * hb + ck[1] * hm + ck[2] * hh + ck[3] * he;
      h = lerp(h, hc, coast);
    }
    if (tw > 0.97 && tw < 1.02) h += 0.1 * n.noise2(x * 0.2, z * 0.2);        // tidal-flat ripples
    if (h < -7) h = -7;
    if (this.banded) h = this._features(x, z, h, tw);
    return h;
  }
  /** banded world: rocky islets and the reef out at sea, a big red rock in the outback, and the soft ranges round the edge */
  _features(x, z, h, tw) {
    const n = this.n;
    if (tw > 1.0) {
      for (const p of ISLETS) {
        const d = Math.hypot(x - p.x, (z - p.z) * 1.25);
        if (d > p.r) continue;
        const k = 1 - ss(p.r * 0.45, p.r, d + n.noise2(x * 0.08, z * 0.08) * 3);
        h = lerp(h, p.top + 0.5 * n.noise2(x * 0.12 + 3, z * 0.12), k);
      }
    }
    // the big red rock (a rounded, Uluru-like monolith): steep soft sides, a gently domed top
    {
      const dx = (x - ROCK.x) / ROCK.rx, dz = (z - ROCK.z) / ROCK.rz, rr = Math.hypot(dx, dz) + n.noise2(x * 0.05, z * 0.05) * 0.05;
      if (rr < 1.12) h += ROCK.h * ss(1.1, 0.78, rr) * (0.92 + 0.08 * (1 - rr * rr));
    }
    // the ranges: rolling soft foothills rising out of the land on three sides (and as headlands into the sea at the corners)
    const eo = this.edgeOut(x, z);
    if (eo > -40) {
      const k = ss(-30, 170, eo);
      h += 46 * Math.pow(k, 1.25) * (0.72 + 0.4 * (n.fbm(x * 0.007 + 13, z * 0.007 - 29, 3) * 0.5 + 0.5));
    }
    return h;
  }
  /**
   * THE ground height. Before freezeTerrain() it is the analytic terrain (+ carved puddles / streams); after, it is the
   * height of the terrain MESH that is drawn: the same 2.5 m grid, interpolated over the same triangles as
   * WorldView._terrainChunk (diagonal b-d), so nothing placed with it can hover above (or sink under) what the player sees.
   */
  heightAt(x, z) {
    if (!this._grid) return this.rawHeightAt(x, z);
    const cell = this._cell;
    const fx = (x + this.half) / cell, fz = (z + this.half) / cell;
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
    const a = this.gridH(ix, iz), b = this.gridH(ix + 1, iz), d = this.gridH(ix, iz + 1);
    if (u + v <= 1) return a + u * (b - a) + v * (d - a);
    const e = this.gridH(ix + 1, iz + 1);
    return e + (1 - u) * (d - e) + (1 - v) * (b - e);
  }
  /** lock the terrain: from now on heights come from the cached mesh grid (call after the last carve, before placing anything).
   *  The grid is unbounded: 64 x 64 vertex tiles are created on demand, so the land can go on forever. */
  freezeTerrain() {
    this._cell = this.cfg.terrainCell;
    this._grid = new Map(); this._tk = NaN; this._tt = null;
  }
  /** height of one mesh vertex (ix, iz = grid indices from the original map's -x/-z corner; may be negative), computed once */
  gridH(ix, iz) {
    const tx = ix >> 6, tz = iz >> 6, key = tz * 100003 + tx;
    let t;
    if (key === this._tk) t = this._tt;
    else {
      t = this._grid.get(key);
      if (!t) { t = new Float32Array(64 * 64).fill(NaN); this._grid.set(key, t); }
      this._tk = key; this._tt = t;
    }
    const k = (iz & 63) * 64 + (ix & 63);
    let v = t[k];
    if (v !== v) { t[k] = this.rawHeightAt(-this.half + ix * this._cell, -this.half + iz * this._cell); v = t[k]; }   // read back the float32: the first and later reads agree exactly
    return v;
  }
  _dirtyGrid(x, z, reach) {
    const c = this._cell;
    const i0 = Math.floor((x - reach + this.half) / c) - 1, i1 = Math.ceil((x + reach + this.half) / c) + 1;
    const j0 = Math.floor((z - reach + this.half) / c) - 1, j1 = Math.ceil((z + reach + this.half) / c) + 1;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const t = this._grid.get((j >> 6) * 100003 + (i >> 6)); if (t) t[(j & 63) * 64 + (i & 63)] = NaN;
    }
  }
  /** unit normal of the drawn triangle under (x, z) */
  faceNormal(x, z, out = { x: 0, y: 1, z: 0 }) {
    if (!this._grid) return this.normalAt(x, z, out);
    const cell = this._cell;
    const fx = (x + this.half) / cell, fz = (z + this.half) / cell;
    const ix = Math.floor(fx), iz = Math.floor(fz), u = fx - ix, v = fz - iz;
    const a = this.gridH(ix, iz), b = this.gridH(ix + 1, iz), d = this.gridH(ix, iz + 1);
    let hx, hz;
    if (u + v <= 1) { hx = (b - a) / cell; hz = (d - a) / cell; }
    else { const e = this.gridH(ix + 1, iz + 1); hx = (e - d) / cell; hz = (e - b) / cell; }
    const l = Math.hypot(hx, 1, hz);
    out.x = -hx / l; out.y = 1 / l; out.z = -hz / l;
    return out;
  }
  /** terrain height including carved puddles, streams and levelled house lots (analytic; the mesh samples this at its vertices) */
  rawHeightAt(x, z) {
    const base = this.baseHeight(x, z);
    const list = this.carveHash.at(x, z);
    let h = base, wMax = 0;
    if (list.length) {
      let wSum = 0, hSum = 0;
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        const d = Math.hypot(x - c.x, z - c.z);
        const reach = c.r * 1.7;
        if (d >= reach) continue;
        const w = 1 - ss(c.r * 0.85, reach, d);
        wSum += w; hSum += w * (c.H - c.depth);
        if (w > wMax) wMax = w;
      }
      if (wSum) h = lerp(base, hSum / wSum, wMax);
    }
    const pads = this.padHash.at(x, z);
    if (!pads.length || wMax >= 1) return h;
    const keep = 1 - wMax;                                  // a real pool keeps its dip; a house lot never overlaps one
    for (let i = 0; i < pads.length; i++) {
      const k = housePadWeight(pads[i], x, z);
      if (k > 0) h = lerp(h, pads[i].H, k * keep);
    }
    return h;
  }
  /**
   * Level the ground under a house to H. The flat rect covers the footprint, the front step and one terrain cell past
   * them (so heightAt, which interpolates the mesh, is exactly H on the step). A smooth blend outside hides the cut.
   */
  addHousePad(h, H) {
    const cell = this.cfg.terrainCell + 0.25;
    const front = 1.7;                                     // step (0.8) plus the flap and the step-off in front of it
    const pad = {
      x: h.x, z: h.z, H,
      hx: h.w / 2 + cell,
      z0: h.z - h.d / 2 - cell,
      z1: h.z + h.d / 2 + front + cell,
      blend: 4.5,
    };
    this.pads.push(pad);
    const reach = Math.max(pad.hx, h.d / 2 + front + cell) + pad.blend;
    this.padHash.add(h.x, h.z, reach, pad);
    if (this._grid) this._dirtyGrid(h.x, h.z, reach);
    return pad;
  }
  normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = 0.8;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const l = Math.hypot(dx, 2 * e, dz);
    out.x = -dx / l; out.y = 2 * e / l; out.z = -dz / l;
    return out;
  }
  /** shallow sea / wet shoreline where the octopus can wade (fast + hydrating) */
  isShallow(x, z) { return this.tAt(x, z) > 0.95 && this.heightAt(x, z) < 0.12 + this.seaLevel; }
  isSea(x, z) { return this.heightAt(x, z) < this.seaLevel - 0.25 && this.tAt(x, z) > 0.95; }
  /** metres of water above the sea floor here (0 on land) */
  seaDepth(x, z) { return this.tAt(x, z) > 0.95 ? Math.max(0, this.seaLevel - this.heightAt(x, z)) : 0; }

  // ---------------- biomes & terrain type ----------------------------------------------
  /** copy of the soft biome weights at x,z (index with B.xxx) */
  biomeWeights(x, z, out = new Float32Array(BIOMES.length)) { out.set(this.biomes.weights(x, z)); return out; }
  biomeAt(x, z) { return BIOMES[this.biomes.at(x, z)]; }

  /** streets: a bowed grid in the suburbs and town, straight every fourth line so a car still has a run.
   *  Between corners the other lines lean (the bow dies out at a crossing so the streets still meet).
   *  One town crossing is a roundabout. Two suburb streets stop in a cul-de-sac. */
  roadBow(along, k, town, ns) {
    if ((((k % 4) + 4) % 4) === 0) return 0;
    const P = town ? 64 : 92;
    let phase = along % P; if (phase < 0) phase += P;
    const edge = Math.min(phase, P - phase);
    const gate = edge <= 10 ? 0 : edge >= 28 ? 1 : (edge - 10) / 18;
    const A = town ? 7.5 + (Math.abs(k) % 3) * 2.2 : 11 + (Math.abs(k) % 3) * 3.2;
    const f = town ? 0.0034 : 0.0028;
    return gate * A * Math.sin(along * f + k * 1.27 + (ns ? 1.9 : 0.2));
  }
  /** cached roundabout and cul-de-sacs. Pure from the seed and roadOff; no extra random draws. */
  roadFeatures() {
    if (this._roads) return this._roads;
    const off = this.roadOff;
    const deads = [];
    const Ps = 92;
    for (let k = -12; k <= 12 && deads.length < 2; k++) {
      if ((((k % 4) + 4) % 4) === 0) continue;
      const z = off.z + k * Ps;
      const dir = deads.length ? 1 : -1;
      const x = off.x + dir * (dir < 0 ? 70 : 150);
      const w = this.biomes.weights(x, z);
      if (w[B.suburb] < 0.5 || w[B.town] > 0.4) continue;
      deads.push({ k, x, z, r: 8.2, dir });
    }
    const Pt = 64;
    let rb = null;
    const x0 = off.x + Math.round((40 - off.x) / Pt) * Pt;
    const z0 = off.z + Math.round((230 - off.z) / Pt) * Pt;
    for (let a = -3; a <= 3 && !rb; a++) for (let b = -3; b <= 3 && !rb; b++) {
      const x = x0 + a * Pt, z = z0 + b * Pt;
      const w = this.biomes.weights(x, z);
      if (w[B.town] > 0.5) rb = { x, z, r: 12.5, inner: 5.6 };
    }
    this._roads = { deads, rb };
    return this._roads;
  }
  /** false on the stopped side of a cul-de-sac street. Town streets and the straight lines stay open. */
  roadOpen(x, axis, k, town) {
    if (town || axis !== 'x') return true;
    const deads = this.roadFeatures().deads;
    for (let i = 0; i < deads.length; i++) {
      const d = deads[i];
      if (d.k !== k) continue;
      if (d.dir < 0 && x > d.x + 0.4) return false;
      if (d.dir > 0 && x < d.x - 0.4) return false;
    }
    return true;
  }
  /** centre of the nearest street. alongX: an east-west street (z bows with x). */
  roadCenter(x, z, alongX) {
    const w = this.biomes.weights(x, z);
    const town = w[B.town] > 0.4;
    const P = town ? 64 : 92;
    if (alongX) {
      const k = Math.round((z - this.roadOff.z) / P);
      const base = this.roadOff.z + k * P;
      return { x, z: base + this.roadBow(x, k, town, false), k, town, P };
    }
    const k = Math.round((x - this.roadOff.x) / P);
    const base = this.roadOff.x + k * P;
    return { x: base + this.roadBow(z, k, town, true), z, k, town, P };
  }
  isRoad(x, z, margin = 0) {
    const w = this.biomes.weights(x, z);
    const town = w[B.town] > 0.4, urb = w[B.suburb] + w[B.town];
    if (urb < 0.45) return false;
    const feat = this.roadFeatures();
    const rb = feat.rb;
    let island = false;
    if (rb && town) {
      const d = Math.hypot(x - rb.x, z - rb.z);
      if (d < rb.r + margin && d > rb.inner - margin) return true;
      if (d < rb.inner) island = true;
    }
    if (!island) {
      const P = town ? 64 : 92, hw = (town ? 5.0 : 4.2) + margin;
      const off = this.roadOff;
      const kz = Math.round((z - off.z) / P);
      for (let dk = -1; dk <= 1; dk++) {
        const k = kz + dk;
        if (!this.roadOpen(x, 'x', k, town)) continue;
        const cz = off.z + k * P + this.roadBow(x, k, town, false);
        if (Math.abs(z - cz) <= hw) return true;
      }
      const kx = Math.round((x - off.x) / P);
      for (let dk = -1; dk <= 1; dk++) {
        const k = kx + dk;
        const cx = off.x + k * P + this.roadBow(z, k, town, true);
        if (Math.abs(x - cx) <= hw) return true;
      }
    }
    const deads = feat.deads;
    for (let i = 0; i < deads.length; i++) {
      const d = deads[i];
      if (!town && Math.hypot(x - d.x, z - d.z) <= d.r + margin) return true;
    }
    return false;
  }
  inLot(x, z, margin = 0) {
    for (const l of this.lots || EMPTY) if (Math.abs(x - l.x) < l.hw + margin && Math.abs(z - l.z) < l.hd + margin) return true;
    return false;
  }
  /** rounded paddocks: warped low-frequency blobs, a thin gravel ribbon on some edges, no square grid */
  farmKind(x, z) {
    const n = this.n;
    const wx = n.fbm(x * 0.016 + 3, z * 0.016 - 8, 2) * 34;
    const wz = n.fbm(x * 0.016 - 11, z * 0.016 + 5, 2) * 34;
    const a = n.fbm((x + wx) * 0.0065 + 2, (z + wz) * 0.0065 - 4, 3);
    const b = n.fbm((x + wx) * 0.013 + 19, (z + wz) * 0.011 - 6, 2);
    if (Math.abs(a) < 0.055 && Math.abs(b) > 0.12) return 'gravel';
    return a * 0.8 + b * 0.2 > 0.02 ? 'plough' : 'pasture';
  }
  baseType(x, z) {
    const n = this.n;
    const tw = this.tAt(x, z);
    if (this.banded) {
      const eo = this.edgeOut(x, z);
      if (eo > 18) { const hh = this.baseHeight(x, z); return hh > 30 ? 'snow' : n.fbm(x * 0.03, z * 0.03, 2) > 0.05 ? 'alpine' : 'rock'; }
      if (tw > 1.0) return this.baseHeight(x, z) > 0.5 ? 'headland' : 'wet';
      if (Math.hypot((x - ROCK.x) / ROCK.rx, (z - ROCK.z) / ROCK.rz) < 0.98) return 'redrock';
    }
    if (tw > 1.0) return 'wet';
    const w = this.biomes.weights(x, z);
    // ground in an ecotone: soft blobs of both biomes across the blend, pure in the middle of each
    let id = 0, best = -9;
    for (let i = 0; i < w.length; i++) {
      if (w[i] < 0.02) continue;
      const sc = w[i] >= 0.86 ? w[i] + 1 : w[i] + 0.2 * n.fbm(x * 0.018 + i * 3.1, z * 0.018 - i * 1.7, 2);
      if (sc > best) { best = sc; id = i; }
    }
    switch (BIOMES[id]) {
      case 'suburb': {
        if (this.isRoad(x, z)) return 'road';
        const wx = n.fbm(x * 0.018 + 2, z * 0.018, 2) * 26;
        const wz = n.fbm(x * 0.018 - 6, z * 0.018 + 4, 2) * 26;
        return n.fbm((x + wx) * 0.01 + 8, (z + wz) * 0.01, 3) > 0.08 ? 'grass' : 'lawn';
      }
      case 'town': {
        if (this.isRoad(x, z)) return 'road';
        if (this.inLot(x, z, 0)) return 'paving';
        if (this.isRoad(x, z, 2.8)) return 'paving';
        const wx = n.fbm(x * 0.02 + 1, z * 0.02, 2) * 18;
        const wz = n.fbm(x * 0.02 + 5, z * 0.02 - 2, 2) * 18;
        return n.fbm((x + wx) * 0.012 + 4, (z + wz) * 0.012, 3) > 0.02 ? 'lawn' : 'paving';
      }
      case 'farm': return this.farmKind(x, z);
      case 'bush': {
        const r = n.fbm(x * 0.016 + 9, z * 0.016 - 4, 3);
        if (r > 0.34 && tw > 0.5) return 'rock';
        const wm = n.fbm(x * 0.012 - 80, z * 0.012 + 30, 3);
        if (wm > 0.42) return 'mud';
        const f = n.fbm(x * 0.02 + 50, z * 0.02 - 20, 3);
        if (f > 0.3) return 'grass';
        return f < -0.28 ? 'scrub' : 'litter';
      }
      case 'riverbank': {
        const cd = this.creekDist(x, z);
        if (cd < 4.5) return 'mud';
        return n.fbm(x * 0.05, z * 0.05) > 0.1 ? 'gravel' : 'bank';
      }
      case 'wetland':
        if (tw > 0.935) return 'wet';
        return n.fbm(x * 0.03 + 3, z * 0.03 + 11, 2) > 0.2 ? 'mud' : 'swamp';
      case 'dunes':
        return n.fbm(x * 0.03, z * 0.03 + 4, 3) > 0.15 ? 'dunegrass' : 'dune';
      case 'beach':
        return tw < 0.965 ? (n.fbm(x * 0.05 + 3, z * 0.05 + 11, 2) > 0.5 ? 'rock' : 'sand') : 'wet';
      case 'headland':
        if (tw > 0.975) return 'wet';
        if (tw > 0.93) return 'rock';
        {
          const f = n.fbm(x * 0.03 + 7, z * 0.03 - 2, 3);
          return f > 0.25 ? 'scrub' : f < -0.2 ? 'rock' : 'headland';
        }
      case 'desert': {
        const f = n.fbm(x * 0.02 + 31, z * 0.02 - 17, 3);
        return f > 0.3 ? 'gibber' : f < -0.22 ? 'spinifex' : 'redsand';
      }
      case 'rainforest':
        return n.fbm(x * 0.03 - 41, z * 0.03 + 5, 3) > 0.05 ? 'mossy' : 'fern';
      case 'estuary':
        return n.fbm(x * 0.05 + 3, z * 0.05 + 11, 2) > 0.4 ? 'sand' : tw > 0.93 ? 'wet' : 'swamp';
      case 'mudflat': {
        const f = n.fbm(x * 0.025 + 61, z * 0.025 - 7, 3);
        return f > 0.28 ? 'swamp' : f < -0.25 ? 'cracked' : 'mud';
      }
      case 'wasteland': {
        const f = n.fbm(x * 0.02 - 71, z * 0.02 + 19, 3);
        return f > 0.3 ? 'slag' : f < -0.3 ? 'paving' : 'ash';
      }
      default: return 'wet';
    }
  }
  typeAt(x, z) {
    let t = this.baseType(x, z);
    // muddy / wet rim around puddles and streams
    const list = this.carveHash.at(x, z);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (Math.hypot(x - c.x, z - c.z) < c.r * 1.35) {
        if (t === 'sand' || t === 'dune' || t === 'dunegrass' || t === 'wet') return 'wet';
        if (t === 'rock' || t === 'headland' || t === 'road' || t === 'paving' || t === 'gravel') return t;
        return 'mud';
      }
    }
    return t;
  }

  // ---------------- water ----------------------------------------------------------
  waterAt(x, z) {
    // static sources
    const list = this.waterHash.at(x, z);
    let best = null;
    for (let i = 0; i < list.length; i++) {
      const w = list[i];
      if (w.kind === 'sludge') continue;                          // wasteland sludge is not water: it neither drinks nor drowns
      const lim = w.kind === 'sprinkler' ? w.r : w.r * 0.95;
      if (Math.hypot(x - w.x, z - w.z) < lim) {
        if (!best || (this.cfg.water[w.kind] ?? 20) > (this.cfg.water[best.kind] ?? 20)) best = w;
      }
    }
    if (best) return best;
    for (let i = 0; i < this.seasonal.length; i++) {
      const q = this.seasonal[i];
      if (this.gates[q.gate] > 0.3 && Math.abs(x - q.x) < q.r && Math.abs(z - q.z) < q.r && Math.hypot(x - q.x, z - q.z) < q.r) return q;
    }
    for (let i = 0; i < this.temp.length; i++) {
      const q = this.temp[i];
      if (q.grow > 0.5 && Math.hypot(x - q.x, z - q.z) < q.r * q.grow) return q;
    }
    for (const c of this.rain) if (Math.hypot(x - c.x, z - c.z) < c.r) return c;
    return null;
  }
  update(dt, anchor) {
    // rain clouds drift freely. With no map edge they are kept around the octopus: one that wanders too far away is
    // re-seeded on the far side of it (and fewer clouds form far inland, where the land is drier).
    for (const c of this.rain) {
      c.x += c.vx * dt; c.z += c.vz * dt;
      if (anchor && Math.hypot(c.x - anchor.x, c.z - anchor.z) > 900) {
        const a = Math.atan2(c.z - anchor.z, c.x - anchor.x) + Math.PI + (Math.random() - 0.5) * 1.2, d = 700 + Math.random() * 150;
        c.x = anchor.x + Math.cos(a) * d; c.z = anchor.z + Math.sin(a) * d;
      }
    }
  }

  _addWater(kind, x, z, r, opts = {}) {
    // a still pool is a level dip: its water level is the LOWEST ground around its rim, so carving only ever digs (never
    // builds a lip) and the surface can never stand above the ground on the downhill side. Streams follow the slope instead.
    const H = opts.H ?? (STILL.has(kind) && opts.carve !== false ? this._ringMin(x, z, r) : this.baseHeight(x, z));
    const w = { kind, x, z, r, H, carve: opts.carve !== false, depth: opts.depth ?? 0.1 };
    this.waters.push(w);
    this.waterHash.add(x, z, r, w);
    this.centreHash.add(x, z, 0, w);
    if (w.carve) {
      this.carveHash.add(x, z, r * 1.7, w);
      if (this._grid) this._dirtyGrid(x, z, r * 1.7);     // a late carve: forget the cached mesh heights it changes
    }
    return w;
  }
  /** lowest and spread (max - min) of the natural ground around a ring of radius r (and the bank just outside it) */
  _ringStats(x, z, r) {
    let lo = this.baseHeight(x, z), hi = lo;
    for (const k of [1, 1.3]) for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, h = this.baseHeight(x + Math.cos(a) * r * k, z + Math.sin(a) * r * k);
      if (h < lo) lo = h; if (h > hi) hi = h;
    }
    return { lo, hi, spread: hi - lo };
  }
  _ringMin(x, z, r) { return this._ringStats(x, z, r * 0.96).lo; }
  _slope(x, z, r) {
    const a = this.baseHeight(x + r, z), b = this.baseHeight(x - r, z), c = this.baseHeight(x, z + r), d = this.baseHeight(x, z - r);
    return Math.max(Math.abs(a - b), Math.abs(c - d)) / (2 * r);
  }
  /** is there NO water centre within distance d? */
  _farFromWater(x, z, d) {
    const c = this.centreHash.cell, r = Math.ceil(d / c);
    const ix = Math.floor(x / c), iz = Math.floor(z / c);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const list = this.centreHash.map.get(this.centreHash.key(ix + a, iz + b));
      if (!list) continue;
      for (const w of list) if (Math.hypot(w.x - x, w.z - z) < d) return false;
    }
    return true;
  }
  /** a random land spot inside one of the named biomes (dominant weight > minW); null after too many failures */
  _spotB(names, { minW = 0.55, maxSlope = 0.2, slopeR = 3, minH = 1.0, notRoad = true, tries = 120, edge = 40, rnd = this.rnd, rect = null } = {}) {
    const ids = names.map((nm) => B[nm]);
    for (let i = 0; i < tries; i++) {
      const x = rect ? rnd.range(rect.x0, rect.x1) : rnd.range(-this.half + edge, this.half - edge);
      const z = rect ? rnd.range(rect.z0, rect.z1) : rnd.range(-this.half + edge, this.half - edge);
      if (this.banded && this.edgeOut(x, z) > -8) continue;           // nothing is built up in the ranges
      const w = this.biomes.weights(x, z);
      let ok = false;
      for (const id of ids) if (w[id] > minW) { ok = true; break; }
      if (!ok) continue;
      if (notRoad && this.isRoad(x, z, 3)) continue;
      const h = this.baseHeight(x, z);
      if (h < minH) continue;
      if (this._slope(x, z, slopeR) > maxSlope) continue;
      return { x, z, tt: this.tAt(x, z) };
    }
    return null;
  }
  /** random land spot by progress range (kept for tests / generic use) */
  _spot(t0, t1, { maxSlope = 0.2, slopeR = 3, minH = 1.0, notRoad = true, tries = 80, edge = 40 } = {}) {
    for (let i = 0; i < tries; i++) {
      const x = this.rnd.range(-this.half + edge, this.half - edge);
      const z = this.rnd.range(-this.half + edge, this.half - edge);
      const tt = this.tAt(x, z);
      if (tt < t0 || tt > t1) continue;
      if (notRoad && this.isRoad(x, z, 3)) continue;
      const h = this.baseHeight(x, z);
      if (h < minH) continue;
      if (this._slope(x, z, slopeR) > maxSlope) continue;
      return { x, z, tt };
    }
    return null;
  }

  _placeStart() {
    // `home` is the canonical garden in the suburbs (its tap and puddle); the houses, maze and small places are laid out around it
    let sx = this.banded ? -215 : this.dir.x * this.cStart, sz = this.banded ? 235 : this.dir.z * this.cStart;
    for (let i = 0; i < 200; i++) {
      const x = sx + this.rnd.range(-26, 26) , z = sz + this.rnd.range(-26, 26);
      if (this.isRoad(x, z, 12) || this._slope(x, z, 3) > 0.12 || this.biomes.weights(x, z)[B.suburb] < 0.8 || this.baseHeight(x, z) < 1.5) continue;
      sx = x; sz = z; break;
    }
    this.start = { x: sx, z: sz };
    this.home = { x: sx, z: sz };
    if (!this.banded) return;
    // every game begins in the sea, beside a big shell in the shallows off the beach (the future Octo house)
    let shell = null;
    for (let zz = SHORE_Z + 18; zz < SHORE_Z + 160 && !shell; zz += 2) {
      const xx = -60, d = -this.baseHeight(xx, zz);
      if (d > 0.75 && d < 1.6) shell = { x: xx, z: zz };
    }
    this._shell = shell || { x: -60, z: SHORE_Z + 50 };
    this.start = { x: this._shell.x + 5, z: this._shell.z + 4 };
  }

  /**
   * ONE fixed world, a different start every game. `home` is where the canonical start garden is (its tap and puddle);
   * `start` is where THIS game begins. pickSpawn() chooses a dry, flat, walkable spot on the inland side of the map (so the
   * sea is a long way off in a direction the player cannot know), with a drink of water close by.
   */
  spawnOk(x, z) {
    if (this.banded) {                                                   // in the water near the big shell, clear of it and of the reef city
      const s = this._shell, d = this.seaLevel - this.heightAt(x, z);
      return !!s && Math.hypot(x - s.x, z - s.z) < 30 && d > 0.35 && d < 2.4 && !this._blocked(x, z, 1.6);
    }
    if (Math.abs(x) > this.half - 70 || Math.abs(z) > this.half - 70) return false;
    if (this.heightAt(x, z) < 1.0 || this.waterAt(x, z) || this._blocked(x, z, 3) || this.isRoad(x, z, 8) || this._slope(x, z, 3) > 0.15) return false;
    if (this.inLot(x, z, 4)) return false;
    const w = this.biomes.weights(x, z);
    if (w[B.suburb] + w[B.town] + w[B.farm] + w[B.bush] + w[B.riverbank] < 0.8) return false;
    for (const q of this.waters) { const d = Math.hypot(q.x - x, q.z - z) - q.r; if (d < 95 && d > 4) return true; }
    return false;
  }
  /** a random valid start point (rnd: a seeded random function, so the daily start is the same for everybody) */
  pickSpawn(rnd, apply = true) {
    if (this.banded) {
      const s = this._shell;
      for (let i = 0; i < 400; i++) {
        const a = rnd() * Math.PI * 2, d = rnd.range ? rnd.range(5, 16) : 5 + rnd() * 11;
        const x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
        if (!this.spawnOk(x, z)) continue;
        if (apply) this.start = { x, z };
        return { x, z };
      }
      const p = { x: s.x + 5, z: s.z + 6 };
      if (apply) this.start = p;
      return p;
    }
    for (let i = 0; i < 800; i++) {
      const u = rnd.range(-0.78, 0.78) * this.half, t = rnd.range(-0.08, 0.5);
      const p = this.shorePoint(u, t);
      if (!this.spawnOk(p.x, p.z)) continue;
      if (apply) this.start = { x: p.x, z: p.z };
      return { x: p.x, z: p.z };
    }
    return { x: this.home.x, z: this.home.z };
  }
  setSpawn(x, z) {
    if (this.banded && Number.isFinite(x) && Number.isFinite(z)) { const c = this.clampToBounds(x, z, { x, z }); x = c.x; z = c.z; }   // an old position outside the ranges comes back inside
    if (!Number.isFinite(x) || !Number.isFinite(z)) { const s = this.shell || { x: 0, z: 0 }; x = s.x + 5; z = s.z + 6; }
    this.start = { x, z };
  }

  _placeWater() {
    const W = this.cfg.water, rnd = this.rnd, K = this.areaScale;
    const accept = { suburb: 1, town: 0.8, farm: 0.8, bush: 0.7, riverbank: 0.4, wetland: 0.05, dunes: 0.12, beach: 0.06, headland: 0.3, estuary: 0.05, sea: 0 };
    const dominant = (x, z) => { const w = this.biomes.weights(x, z); let id = 0; for (let i = 1; i < w.length; i++) if (w[i] > w[id]) id = i; return BIOMES[id]; };

    // A friendly drip tap + puddle near the start so the first seconds teach the idea.
    {
      const a = rnd() * Math.PI * 2, d = 9;
      const tx = this.home.x + Math.cos(a) * d, tz = this.home.z + Math.sin(a) * d;
      this._addWater('drip', tx, tz, 2.3, { depth: 0.12 });
      this.taps.push({ type: 'tap', x: tx, z: tz, rot: rnd() * 6.28 });
      const px = this.home.x - Math.cos(a) * 14, pz = this.home.z - Math.sin(a) * 14;
      this._addWater('puddle', px, pz, 3.2);
    }
    // the creek and its tributary (stream discs along the centre line; they carve the channel)
    {
      const lay = (list, r0, r1) => {
        const hs = list.map((p) => this.baseHeight(p.x, p.z));
        const N = list.length;
        for (let i = 0; i < N; i++) {
          let sum = 0, c = 0;
          for (let j = -8; j <= 8; j++) { sum += hs[clamp(i + j, 0, N - 1)]; c++; }
          let H = sum / c - 0.08;
          const s = i / (N - 1);
          if (s > 0.8) H = lerp(H, 0.12, ss(0.8, 1.0, s));        // the last stretch settles to sea level
          list[i].H = H;
          const p = list[i];
          if (this.tAt(p.x, p.z) > 0.985) break;
          const r = lerp(r0, r1, s) * (s > 0.9 ? 1 + (s - 0.9) * 12 : 1);
          if (i % 2 === 0) {
            // t241u: a stream disc never hangs over a dip in its rim (the window average can sit above a local hollow)
            let Hd = H;
            if (s <= 0.93) { for (let k = 0; k < 8; k++) { const a = k * 0.785; Hd = Math.min(Hd, this.baseHeight(p.x + Math.cos(a) * r * 1.15, p.z + Math.sin(a) * r * 1.15) - 0.06); } }
            this._addWater(s > 0.93 ? 'estuary' : 'stream', p.x, p.z, r, { H: Hd, depth: 0.1 });
          }
        }
      };
      lay(this.creek, 2.0, 3.6);
      lay(this.creekTrib, 1.7, 2.4);
    }
    const put = (kind, count, names, rr, opts = {}) => {
      let made = 0;
      for (let i = 0; i < count * (opts.spread !== undefined ? 40 : 8) && made < count; i++) {
        const s = this._spotB(names, { maxSlope: opts.maxSlope ?? 0.1, slopeR: rr[1], minH: opts.minH ?? 1.0, minW: opts.minW ?? 0.55 });
        if (!s) continue;
        if (opts.zone) { const b = dominant(s.x, s.z); if (rnd() > (accept[b] ?? 0.5)) continue; }
        if (!this._farFromWater(s.x, s.z, opts.spacing ?? 14)) continue;
        const r = rnd.range(rr[0], rr[1]);
        if (this.typeAt(s.x, s.z) === 'road') continue;
        if (opts.spread !== undefined && this._ringStats(s.x, s.z, r).spread > opts.spread) continue;     // too sloped to hold a level pool
        if (this.creekDist(s.x, s.z) < r + 12) continue;                                                     // the creek carves its own banks: keep pools clear of them
        this._addWater(kind, s.x, s.z, r, { depth: opts.depth ?? 0.1 });
        made++;
      }
      return made;
    };
    const ALL = ['suburb', 'town', 'farm', 'bush', 'riverbank', 'headland'];
    put('puddle', Math.round(W.puddleCount * K), ALL, [2.6, 4.4], { zone: true, spacing: 16, minW: 0.5, maxSlope: 0.05, spread: 0.15 });
    put('dam', Math.round(8 * K / 4 * 1), ['farm'], [9, 13], { spacing: 60, depth: 0.4, maxSlope: 0.04, spread: 0.5 });
    put('pond', Math.round((W.pondCount ?? 6) * K * 0.5), ['bush', 'suburb', 'riverbank'], [5, 8], { spacing: 40, depth: 0.35, maxSlope: 0.06, spread: 0.2 });
    put('pond', Math.round(10 * K), ['wetland'], [4, 8], { spacing: 18, depth: 0.3, maxSlope: 0.07, spread: 0.2, minH: 0.5, minW: 0.5 });
    put('tidepool', Math.round(W.tidepoolCount * K * 0.8), ['headland'], [2.6, 4.4], { spacing: 12, minH: 0.2, maxSlope: 0.1, spread: 0.24, depth: 0.2, minW: 0.3 });
    put('tidepool', Math.round(W.tidepoolCount * K * 0.15), ['beach', 'estuary'], [2.2, 3.4], { spacing: 25, minH: 0.2, maxSlope: 0.08, spread: 0.24, depth: 0.2, minW: 0.3 });
    if (this.banded) {
      // mud flats: puddles everywhere (the boardwalk runs over them); a few rare soaks out in the red outback
      put('puddle', Math.round(30 * K), ['mudflat'], [2.4, 5.0], { spacing: 11, minH: 0.4, maxSlope: 0.06, spread: 0.18, minW: 0.5 });
      put('puddle', Math.round(2 * K), ['desert'], [2.2, 3.2], { spacing: 90, maxSlope: 0.05, spread: 0.15 });
      // the oasis: one still pond near the big red rock (palms are planted round it in areas.js)
      for (let i = 0; i < 600 && !this.oasis; i++) {
        const a = rnd() * 6.28, d = rnd.range(85, 150), x = ROCK.x + Math.cos(a) * d, z = ROCK.z + Math.sin(a) * d * 0.7;
        if (this.biomes.weights(x, z)[B.desert] < 0.8 || this._slope(x, z, 8) > 0.06 || this._ringStats(x, z, 7).spread > 0.25 || this.creekDist(x, z) < 30) continue;
        this.oasis = this._addWater('pond', x, z, 7, { depth: 0.35 });
      }
      // wasteland: level pools of purple and yellow sludge (never green), and nothing to drink
      put('sludge', Math.round(9 * K), ['wasteland'], [3, 6.5], { spacing: 22, minH: 0.4, maxSlope: 0.06, spread: 0.2, depth: 0.25, minW: 0.6 });
      for (const q of this.waters) if (q.kind === 'sludge') q.alt = ((q.x * 13.7 + q.z * 7.3) % 2 + 2) % 2 > 1 ? 1 : 0;
    }
    // leaky taps in gardens, dripping seeps in the bush and on the headlands, pumps on the farm
    {
      const total = Math.round(W.dripCount * K);
      const plan = [['tap', ['suburb'], 0.28], ['seep', ['bush', 'headland'], 0.3], ['pump', ['farm'], 0.14], ['ac', ['town'], 0.28]];
      for (const [type, names, share] of plan) {
        let made = 0; const target = Math.round(total * share);
        for (let i = 0; i < 2000 && made < target; i++) {
          const s = this._spotB(names, { maxSlope: 0.12, tries: 30 });
          if (!s || !this._farFromWater(s.x, s.z, 20)) continue;
          if (this._ringStats(s.x, s.z, 2.3).spread > 0.2) continue;       // the little pools under taps and air-con units sit in level ground too
          if (type === 'ac') { if (this.isRoad(s.x, s.z, 8)) continue; this._addWater('aircon', s.x, s.z, 2.0, { depth: 0.08 }); }
          else if (type === 'pump') this._addWater('trough', s.x, s.z, 2.2, { depth: 0.1 });
          else this._addWater('drip', s.x, s.z, 2.3, { depth: 0.1 });
          this.taps.push({ type, x: s.x, z: s.z, rot: rnd() * 6.28 });
          made++;
        }
      }
    }
    // sprinklers on lawns (no carving, just a big wet zone)
    {
      let made = 0;
      const a = rnd() * 6.28;
      const first = { x: this.home.x + Math.cos(a) * 24, z: this.home.z + Math.sin(a) * 24 };
      const list = [];
      if (!this.isRoad(first.x, first.z, 8)) list.push(first);
      const target = Math.round(W.sprinklerCount * K);
      for (let i = 0; i < 600 && made + list.length < target; i++) {
        const s = this._spotB(['suburb', 'farm'], { maxSlope: 0.1, tries: 20 });
        if (!s || !this._farFromWater(s.x, s.z, 24)) continue;
        list.push(s); made++;
      }
      for (const s of list) this.sprinklers.push(this._addWater('sprinkler', s.x, s.z, 6.5, { carve: false }));
    }
    // small streams that run toward the coast (a gentle natural hint), ending in the creek or fading out
    for (let k = 0; k < Math.round(W.streamCount * K * 0.5); k++) {
      const s = this._spotB(['bush', 'farm'], { maxSlope: 0.3, tries: 60 });
      if (!s) continue;
      let x = s.x, z = s.z;
      let ang = Math.atan2(this.dir.z, this.dir.x) + rnd.range(-0.9, 0.9);
      const pts = [];
      const len = Math.floor(rnd.range(20, 40));
      for (let i = 0; i < len; i++) {
        pts.push({ x, z });
        const gx = this.baseHeight(x + 4, z) - this.baseHeight(x - 4, z);
        const gz = this.baseHeight(x, z + 4) - this.baseHeight(x, z - 4);
        const want = Math.atan2(this.dir.z * 0.7 - gz * 0.35, this.dir.x * 0.7 - gx * 0.35);
        let d = want - ang; d = Math.atan2(Math.sin(d), Math.cos(d));
        ang += d * 0.25 + rnd.range(-0.28, 0.28);
        x += Math.cos(ang) * 2.4; z += Math.sin(ang) * 2.4;
        if (Math.abs(x) > this.half - 50 || Math.abs(z) > this.half - 50 || this.tAt(x, z) > 0.88) break;
      }
      if (pts.length < 10) continue;
      const hs = pts.map((p) => this.baseHeight(p.x, p.z));
      let last = 99;
      for (let i = 0; i < pts.length; i++) {
        let sum = 0, c = 0;
        for (let j = -4; j <= 4; j++) { sum += hs[clamp(i + j, 0, pts.length - 1)]; c++; }
        let H = Math.min(sum / c, last); last = H;
        // a stream never runs through a still pool (its carve would warp the pool's rim): leave a gap there
        let hit = false;
        {
          const c = this.centreHash.cell, ix = Math.floor(pts[i].x / c), iz = Math.floor(pts[i].z / c), rr = Math.ceil(14 / c);       // every pool within reach, not just those whose own cells touch this one
          for (let a = -rr; a <= rr && !hit; a++) for (let b = -rr; b <= rr && !hit; b++) for (const q of this.centreHash.map.get(this.centreHash.key(ix + a, iz + b)) || EMPTY) if (STILL.has(q.kind) && Math.hypot(q.x - pts[i].x, q.z - pts[i].z) < q.r * 1.7 + 3.2) { hit = true; break; }
        }
        if (!hit && this._slope(pts[i].x, pts[i].z, 2) < 0.14) {
          // never let the disc hang over a dip in its rim (t241u: found by the placement audit once the new biomes shifted the RNG)
          const px = pts[i].x, pz = pts[i].z; let rim = this.baseHeight(px, pz);
          for (let k = 0; k < 8; k++) { const a = k * 0.785; rim = Math.min(rim, this.baseHeight(px + Math.cos(a) * 1.9, pz + Math.sin(a) * 1.9)); }
          this._addWater('stream', px, pz, 1.7, { H: Math.min(H, rim + 0.02), depth: 0.1 });      // (and none on a steep bank: its disc would hang over the slope)
        }      // (and none on a steep bank: its disc would hang over the slope)
      }
    }
    // rain clouds drifting around
    for (let i = 0; i < Math.round(W.rainCloudCount * K); i++) {
      const s = this._spot(0.05, 0.85, { maxSlope: 9, minH: -5, notRoad: false, edge: 70 });
      if (!s) continue;
      const a = rnd() * 6.28;
      this.rain.push({ kind: 'rain', x: s.x, z: s.z, r: 12, vx: Math.cos(a) * W.rainCloudSpeed, vz: Math.sin(a) * W.rainCloudSpeed });
    }
    // one little shower near the start
    this.rain.push({ kind: 'rain', x: this.start.x + this.dir.x * 20 + 14, z: this.start.z + this.dir.z * 20 - 14, r: 12, vx: 0.5, vz: 0.3 });
  }

  // ---------------- colliders / props ------------------------------------------------
  _addCircle(x, z, r, extra) {
    const c = { x, z, r, ...extra };
    this.colliders.push(c);
    this.colHash.add(x, z, r, c);
    return c;
  }
  _addBox(x, z, hw, hd, extra) {
    const c = { x, z, hw, hd, ...extra };
    this.colliders.push(c);
    this.colHash.add(x, z, Math.max(hw, hd), c);
    return c;
  }
  _blocked(x, z, pad = 0) {
    for (const w of this.waterHash.at(x, z)) if (w.kind !== 'sprinkler' && Math.hypot(x - w.x, z - w.z) < w.r * 1.5 + pad) return true;
    for (const c of this.colHash.at(x, z)) {
      if (c.r !== undefined) { if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true; }
      else if (Math.abs(x - c.x) < c.hw + pad + 1 && Math.abs(z - c.z) < c.hd + pad + 1) return true;
    }
    return false;
  }

  // ---------------- collisions -----------------------------------------------------
  /** push a circle of radius `rad` at (x,z) out of obstacles; returns {x,z,hit} */
  resolve(x, z, rad, out = { x, z, hit: false }) {
    out.x = x; out.z = z; out.hit = false; out.col = null;
    for (let pass = 0; pass < 2; pass++) {
      const list = this.colHash.at(out.x, out.z);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.r !== undefined) {
          const dx = out.x - c.x, dz = out.z - c.z;
          const d = Math.hypot(dx, dz), m = c.r + rad;
          if (d < m) {
            const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
            out.x = c.x + nx * m; out.z = c.z + nz * m; out.hit = true; out.col = c;
          }
        } else {
          const px = clamp(out.x, c.x - c.hw, c.x + c.hw), pz = clamp(out.z, c.z - c.hd, c.z + c.hd);
          const dx = out.x - px, dz = out.z - pz;
          const d = Math.hypot(dx, dz);
          if (d < rad) {
            if (d > 1e-5) { out.x = px + (dx / d) * rad; out.z = pz + (dz / d) * rad; }
            else { // inside the box: push along shortest axis
              const ox = c.hw - Math.abs(out.x - c.x), oz = c.hd - Math.abs(out.z - c.z);
              if (ox < oz) out.x += Math.sign(out.x - c.x || 1) * (ox + rad); else out.z += Math.sign(out.z - c.z || 1) * (oz + rad);
            }
            out.hit = true; out.col = c;
          }
        }
      }
    }
    if (this.banded) {                // the soft wall up in the foothills and past the outer reef (no damage, no UI: it simply holds)
      const ox = out.x, oz = out.z, hit = out.hit;
      this.clampToBounds(ox, oz, out);
      out.hit = hit || out.x !== ox || out.z !== oz;
    }
    return out;
  }


  /** habitat sampling for predators: a free spot inside one of the named biomes (and, optionally, of a ground type) */
  habitatSpot(biomes, types, minFromStart = 35, minW = 0.5) {
    const ids = biomes ? biomes.map((n) => B[n]) : null;
    for (let i = 0; i < 500; i++) {
      const x = this.rnd.range(-this.half + 40, this.half - 40);
      const z = this.rnd.range(-this.half + 40, this.half - 40);
      if (Math.hypot(x - this.start.x, z - this.start.z) < minFromStart) continue;
      if (ids) { const w = this.biomes.weights(x, z); let ok = false; for (const id of ids) if (w[id] > minW) { ok = true; break; } if (!ok) continue; }
      if (types && !types.includes(this.baseType(x, z))) continue;
      const h = this.heightAt(x, z);
      if (h < 0.3) continue;
      if (this._blocked(x, z, 1.5)) continue;
      return { x, z };
    }
    return null;
  }
  /** a random reachable land point inside a biome (used by tests / teleport hooks): the most "central" of a few tries */
  findBiomeSpot(name, tries = 4000, clear = 7) {
    const id = B[name]; let best = null, bw = 0;
    const rnd = mulberry32(this.seed ^ 0xabcdef);
    const reedsNear = (x, z, r) => { for (const q of this.decor.reeds) if (Math.abs(q.x - x) < r && Math.abs(q.z - z) < r) return true; return false; };
    for (let i = 0; i < tries; i++) {
      const x = rnd.range(-this.half + 30, this.half - 30), z = rnd.range(-this.half + 30, this.half - 30);
      if (this.banded && (this.edgeOut(x, z) > -15 || z > EDGE.sea - 20)) continue;
      const w = this.biomes.weights(x, z)[id];
      if (w <= bw) continue;
      const h = this.heightAt(x, z);
      if (name !== 'sea' && h < 0.3) continue;
      if (name === 'sea' && !(this.isSea(x, z) && h < -1.2 && h > -4)) continue;
      // keep the spot clear of trees, rocks, props and reeds so a camera there sees something
      if (name !== 'sea' && (this._blocked(x, z, clear) || reedsNear(x, z, 5))) continue;
      best = { x, z, w }; bw = w;
      if (w > 0.97) break;
    }
    if ((!best || bw < 0.75) && clear > 1.2) { const alt = this.findBiomeSpot(name, tries, clear > 3 ? 3 : 1.2); if (alt && (!best || alt.w > bw)) return alt; }
    return best;
  }

}
