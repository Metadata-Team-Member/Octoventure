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
import { BiomeField, B, BIOMES, COAST_KINDS } from './biomes.js';
import { placeAreas } from './areas.js';
import { scatterGather } from './gather.js';

const ss = smoothstep;

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

const STILL = new Set(['puddle', 'dam', 'pond', 'tidepool', 'drip', 'aircon', 'trough']);

export class WorldData {
  constructor(seed = Math.floor(Math.random() * 1e9), cfg = CONFIG) {
    this.cfg = cfg;
    this.seed = seed >>> 0;
    this.rnd = mulberry32(this.seed ^ 0x9e3779b9);
    this.n = makeNoise(this.seed);
    this.half = cfg.worldSize / 2;
    this.areaScale = (cfg.worldSize / 800) ** 2;      // all "counts" in CONFIG are per 800 x 800 m, so density stays the same on bigger maps

    // --- the secret: which way is the sea? -----------------------------------------
    this.angle = this.rnd() * Math.PI * 2;
    this.dir = { x: Math.cos(this.angle), z: Math.sin(this.angle) };   // points TOWARDS the sea
    this.perp = { x: -this.dir.z, z: this.dir.x };                     // along the shoreline
    this.cStart = -cfg.startDistance * this.half;
    this.cCoast = cfg.coastDistance * this.half;
    this.roadOff = { x: this.rnd() * 90, z: this.rnd() * 90 };

    this.carveHash = new Hash(16);
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
    const w = n.fbm(x * 0.0055 + 311, z * 0.0055 - 77, 3) * 0.06 + n.fbm(x * 0.0016 + 9, z * 0.0016 - 3, 2) * 0.05;
    const j = n.noise2(x * 0.045, z * 0.045) * 0.012;
    return this.progress(x, z) + w + j;
  }
  /** meters from the shoreline along the sea direction (negative = on land) */
  distToSea(x, z) { return (this.tAt(x, z) - 1.0) * (this.cCoast - this.cStart); }
  get span() { return this.cCoast - this.cStart; }
  /** point on the (unwarped) shoreline at lateral position u */
  shorePoint(u, tt = 1) {
    const c = this.cStart + tt * this.span;
    return { x: this.dir.x * c + this.perp.x * u, z: this.dir.z * c + this.perp.z * u };
  }

  /** 0 on the original map, rising to 1 far inland (away from the ocean): the land gets drier and harsher, silently */
  harshAt(x, z) {
    const s = x * this.dir.x + z * this.dir.z;                    // distance along the sea direction from the map centre
    return ss(-this.half * 0.9, -this.half * 3, s);
  }

  // ---------------- coast stretches & the creek (decided first: no heights needed) -----------------
  _makeCoast() {
    const rnd = this.rnd;
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const segs = []; let a = 0;
    for (const k of order) { const wdt = k === 3 ? rnd.range(240, 330) : rnd.range(290, 440); segs.push({ kind: k, a, b: a + wdt }); a += wdt; }
    const period = a;
    const est = segs.find((s) => s.kind === 3);
    const uE = rnd.range(-220, 220);
    const shift = uE - (est.a + est.b) / 2;
    this.coast = { segments: segs, period, shift, estuaryU: uE, kinds: COAST_KINDS };
  }
  /** which stretch of coast is at lateral u: index into COAST_KINDS (dominant) */
  coastKindAt(u) { return this.biomes.coastKinds(u).reduce((best, v, i, arr) => (v > arr[best] ? i : best), 0); }
  /** lateral centre of the nearest stretch of the given kind (for tests / landmark placement) */
  coastCentre(kindName, near = 0) {
    const k = COAST_KINDS.indexOf(kindName), c = this.coast;
    let best = null;
    for (const s of c.segments) if (s.kind === k) for (const off of [-c.period, 0, c.period]) {
      const m = (s.a + s.b) / 2 + off + c.shift;
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
        const m = amp * (Math.sin(s * f1 + p1) * 0.6 + Math.sin(s * f2 + p2) * 0.3) * env;
        pts.push({ x: lerp(S.x, T.x, s) + this.perp.x * m, z: lerp(S.z, T.z, s) + this.perp.z * m, s });
      }
      return pts;
    };
    const uS = this.coast.estuaryU + rnd.range(-240, 240);
    const S = this.shorePoint(uS, 0.27);
    const main = mk(S, E, 55);
    // a tributary that joins the main creek about 60% of the way down
    const j = main[Math.floor(main.length * 0.62)];
    const S2 = this.shorePoint(uS + rnd.range(-260, 260) , 0.5);
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
      w[B.wetland] * 0.5 + w[B.dunes] * 2.4 + w[B.beach] * 0.9 + w[B.headland] * 7.5 + w[B.estuary] * 0.3 + w[B.sea] * 0.8;
    const low = w[B.wetland] + w[B.estuary];
    let h = lerp(2.3, 1.1, low) + amp * (n.fbm(x * 0.011, z * 0.011, 4) + 1) * 0.95 + 0.22 * n.noise2(x * 0.13, z * 0.13) * (1 - low * 0.6);
    // creek valley: the banks slope gently down to the water
    const cd = this.creekDist(x, z);
    if (cd < 22) h -= 0.55 * (1 - ss(3, 22, cd)) * (1 - low);
    // ---- the shore: each stretch of coast has its own profile ------------------------------
    const coast = ss(0.64, 0.74, tw);
    if (coast > 0) {
      const ck = this.biomes.coastKinds(u);
      // beach (+ dunes behind): ridges, then a gentle slope into the sea
      let hb = h + ss(0.7, 0.76, tw) * (1 - ss(0.88, 0.95, tw)) * 3.0 * Math.pow(1 - Math.abs(n.noise2(x * 0.028 + 5, z * 0.028 - 9)), 2);
      hb = lerp(hb, 1.5 - 15 * (tw - 0.9), ss(0.84, 0.95, tw));
      // mangrove wetland: low, flat, muddy; shallow for a long way
      let hm = lerp(h, 0.75 - 4 * (tw - 0.9) + 0.1 * n.noise2(x * 0.2, z * 0.2), ss(0.74, 0.9, tw)) - 14 * ss(1.05, 1.3, tw);
      // headland: high ground, a cliff, a rocky shelf with pools, then deep water
      let hh = lerp(h, 0.55 + 0.35 * n.noise2(x * 0.09, z * 0.09), ss(0.9, 0.972, tw)) - 55 * ss(1.0, 1.1, tw) * 0.2 - 10 * ss(1.02, 1.2, tw);
      hh += ss(0.7, 0.8, tw) * (1 - ss(0.9, 0.95, tw)) * 1.5;
      // estuary: wide mudflats and channels
      let he = lerp(h, 0.5 - 3 * (tw - 0.9) + 0.08 * n.noise2(x * 0.15, z * 0.15), ss(0.78, 0.9, tw)) - 12 * ss(1.06, 1.3, tw);
      const hc = ck[0] * hb + ck[1] * hm + ck[2] * hh + ck[3] * he;
      h = lerp(h, hc, coast);
    }
    if (tw > 0.97 && tw < 1.02) h += 0.1 * n.noise2(x * 0.2, z * 0.2);        // tidal-flat ripples
    if (h < -7) h = -7;
    return h;                                                                  // no world edge: the land (and sea) simply go on
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
  /** terrain height including carved puddles, streams etc. (analytic; the mesh samples this at its vertices) */
  rawHeightAt(x, z) {
    const base = this.baseHeight(x, z);
    const list = this.carveHash.at(x, z);
    if (list.length === 0) return base;
    let wSum = 0, hSum = 0, wMax = 0;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const d = Math.hypot(x - c.x, z - c.z);
      const reach = c.r * 1.7;
      if (d >= reach) continue;
      const w = 1 - ss(c.r * 0.85, reach, d);
      wSum += w; hSum += w * (c.H - c.depth);
      if (w > wMax) wMax = w;
    }
    if (wSum === 0) return base;
    return lerp(base, hSum / wSum, wMax);
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

  /** streets: a grid in the suburbs / town */
  isRoad(x, z, margin = 0) {
    const w = this.biomes.weights(x, z);
    const town = w[B.town] > 0.4, urb = w[B.suburb] + w[B.town];
    if (urb < 0.45) return false;
    const P = town ? 64 : 92, hw = (town ? 5.0 : 4.2) + margin;
    const mx = (((x - this.roadOff.x) % P) + P) % P;
    const mz = (((z - this.roadOff.z) % P) + P) % P;
    return mx < hw || mx > P - hw || mz < hw || mz > P - hw;
  }
  inLot(x, z, margin = 0) {
    for (const l of this.lots || EMPTY) if (Math.abs(x - l.x) < l.hw + margin && Math.abs(z - l.z) < l.hd + margin) return true;
    return false;
  }
  /** ground type (key of TERRAIN) before puddle rims */
  baseType(x, z) {
    const n = this.n;
    const tw = this.tAt(x, z);
    if (tw > 1.0) return 'wet';
    const w = this.biomes.weights(x, z);
    let id = 0;
    for (let i = 1; i < w.length; i++) if (w[i] > w[id]) id = i;
    switch (BIOMES[id]) {
      case 'suburb':
        if (this.isRoad(x, z)) return 'road';
        return n.fbm(x * 0.02 + 8, z * 0.02) > 0.45 ? 'grass' : 'lawn';
      case 'town':
        if (this.isRoad(x, z)) return 'road';
        if (this.inLot(x, z, 0)) return 'paving';
        if (this.isRoad(x, z, 2.8)) return 'paving';
        return n.fbm(x * 0.03 + 4, z * 0.03) > 0.3 ? 'lawn' : 'paving';
      case 'farm': {
        const cx = Math.floor(x / 70), cz = Math.floor(z / 70);
        const hsh = (Math.sin(cx * 127.1 + cz * 311.7 + this.seed * 0.001) * 43758.5453) % 1;
        if ((((x % 70) + 70) % 70) < 2.2 && hsh > 0) return 'gravel';
        return Math.abs(hsh) > 0.6 ? 'plough' : 'pasture';
      }
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
      case 'estuary':
        return n.fbm(x * 0.05 + 3, z * 0.05 + 11, 2) > 0.4 ? 'sand' : tw > 0.93 ? 'wet' : 'swamp';
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
    // start in the garden suburb, off the road, on flat ground
    let sx = this.dir.x * this.cStart, sz = this.dir.z * this.cStart;
    for (let i = 0; i < 200; i++) {
      const x = sx + this.rnd.range(-26, 26) , z = sz + this.rnd.range(-26, 26);
      if (this.isRoad(x, z, 12) || this._slope(x, z, 3) > 0.12 || this.biomes.weights(x, z)[B.suburb] < 0.8 || this.baseHeight(x, z) < 1.5) continue;
      sx = x; sz = z; break;
    }
    this.start = { x: sx, z: sz };
  }

  _placeWater() {
    const W = this.cfg.water, rnd = this.rnd, K = this.areaScale;
    const accept = { suburb: 1, town: 0.8, farm: 0.8, bush: 0.7, riverbank: 0.4, wetland: 0.05, dunes: 0.12, beach: 0.06, headland: 0.3, estuary: 0.05, sea: 0 };
    const dominant = (x, z) => { const w = this.biomes.weights(x, z); let id = 0; for (let i = 1; i < w.length; i++) if (w[i] > w[id]) id = i; return BIOMES[id]; };

    // A friendly drip tap + puddle near the start so the first seconds teach the idea.
    {
      const a = rnd() * Math.PI * 2, d = 9;
      const tx = this.start.x + Math.cos(a) * d, tz = this.start.z + Math.sin(a) * d;
      this._addWater('drip', tx, tz, 2.3, { depth: 0.12 });
      this.taps.push({ type: 'tap', x: tx, z: tz, rot: rnd() * 6.28 });
      const px = this.start.x - Math.cos(a) * 14, pz = this.start.z - Math.sin(a) * 14;
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
          if (i % 2 === 0) this._addWater(s > 0.93 ? 'estuary' : 'stream', p.x, p.z, r, { H, depth: 0.1 });
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
        this._addWater(kind, s.x, s.z, r, { depth: opts.depth ?? 0.1 });
        made++;
      }
      return made;
    };
    const ALL = ['suburb', 'town', 'farm', 'bush', 'riverbank', 'headland'];
    put('puddle', Math.round(W.puddleCount * K), ALL, [2.6, 4.4], { zone: true, spacing: 16, minW: 0.5, maxSlope: 0.05, spread: 0.2 });
    put('dam', Math.round(8 * K / 4 * 1), ['farm'], [9, 13], { spacing: 60, depth: 0.4, maxSlope: 0.04, spread: 0.7 });
    put('pond', Math.round((W.pondCount ?? 6) * K * 0.5), ['bush', 'suburb', 'riverbank'], [5, 8], { spacing: 40, depth: 0.35, maxSlope: 0.06, spread: 0.4 });
    put('pond', Math.round(10 * K), ['wetland'], [4, 8], { spacing: 18, depth: 0.3, maxSlope: 0.07, spread: 0.4, minH: 0.5, minW: 0.5 });
    put('tidepool', Math.round(W.tidepoolCount * K * 0.8), ['headland'], [2.6, 4.4], { spacing: 12, minH: 0.2, maxSlope: 0.1, spread: 0.3, depth: 0.2, minW: 0.3 });
    put('tidepool', Math.round(W.tidepoolCount * K * 0.15), ['beach', 'estuary'], [2.2, 3.4], { spacing: 25, minH: 0.2, maxSlope: 0.08, spread: 0.3, depth: 0.2, minW: 0.3 });
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
      const first = { x: this.start.x + Math.cos(a) * 24, z: this.start.z + Math.sin(a) * 24 };
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
        for (const q of this.carveHash.at(pts[i].x, pts[i].z)) if (STILL.has(q.kind) && Math.hypot(q.x - pts[i].x, q.z - pts[i].z) < q.r * 1.7 + 3.2) { hit = true; break; }
        if (!hit) this._addWater('stream', pts[i].x, pts[i].z, 1.7, { H, depth: 0.1 });
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
    return out;                      // no invisible walls: nothing clamps the octopus to the original map
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
