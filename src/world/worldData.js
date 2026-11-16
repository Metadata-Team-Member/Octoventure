// =====================================================================
//  WorldData - the pure (no three.js) description of one generated world:
//  terrain height, terrain type, water sources, colliders and decoration spots.
//  Everything is derived from a seed so a world can be reproduced exactly.
// =====================================================================
import { CONFIG } from '../config.js';
import { makeNoise } from '../util/noise.js';
import { mulberry32, clamp, lerp, smoothstep } from '../util/rng.js';

const ss = smoothstep;

class Hash {
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

export class WorldData {
  constructor(seed = Math.floor(Math.random() * 1e9), cfg = CONFIG) {
    this.cfg = cfg;
    this.seed = seed >>> 0;
    this.rnd = mulberry32(this.seed ^ 0x9e3779b9);
    this.n = makeNoise(this.seed);
    this.half = cfg.worldSize / 2;

    // --- the secret: which way is the sea? -----------------------------------------
    this.angle = this.rnd() * Math.PI * 2;
    this.dir = { x: Math.cos(this.angle), z: Math.sin(this.angle) };   // points TOWARDS the sea
    this.cStart = -cfg.startDistance * this.half;
    this.cCoast = cfg.coastDistance * this.half;
    this.roadOff = { x: this.rnd() * 80, z: this.rnd() * 80 };

    this.carveHash = new Hash(16);
    this.waterHash = new Hash(16);
    this.colHash = new Hash(12);
    this.waters = [];        // every water source: {kind,x,z,r,H,carve}
    this.rain = [];          // moving rain clouds: {x,z,r,vx,vz}
    this.houses = [];
    this.taps = [];          // visual props for drips / seeps / sprinklers
    this.sprinklers = [];
    this.colliders = [];     // circles {x,z,r} and boxes {x,z,hw,hd}

    this._placeStart();
    this._placeWater();
    this._placeHouses();
    this.decor = this._placeDecor();
  }

  // ---------------- coordinates ----------------------------------------------------
  /** 0 at the start line, 1 at the shoreline (not warped). */
  progress(x, z) { return (x * this.dir.x + z * this.dir.z - this.cStart) / (this.cCoast - this.cStart); }
  /** progress with an irregular coastline / biome borders. */
  tAt(x, z) {
    const w = this.n.fbm(x * 0.0055 + 311, z * 0.0055 - 77, 3) * 0.06;
    const j = this.n.noise2(x * 0.045, z * 0.045) * 0.012;
    return this.progress(x, z) + w + j;
  }
  /** meters from the shoreline along the sea direction (negative = on land) */
  distToSea(x, z) { return (this.tAt(x, z) - 1.0) * (this.cCoast - this.cStart); }

  // ---------------- terrain height -------------------------------------------------
  _zoneAmp(tt) {
    return 0.8 + 2.7 * ss(0.14, 0.26, tt) + 5.6 * ss(0.42, 0.56, tt) - 6.2 * ss(0.68, 0.78, tt) - 2.6 * ss(0.86, 0.94, tt);
  }
  /** terrain before water carving */
  baseHeight(x, z) {
    const n = this.n;
    const tt = this.tAt(x, z);
    const amp = this._zoneAmp(tt);
    let h = 2.3 + amp * (n.fbm(x * 0.011, z * 0.011, 4) + 1) * 0.95 + 0.22 * n.noise2(x * 0.13, z * 0.13);
    const ridge = 1 - Math.abs(n.noise2(x * 0.028 + 5, z * 0.028 - 9));
    h += ss(0.7, 0.76, tt) * (1 - ss(0.88, 0.95, tt)) * 3.0 * ridge * ridge;   // dunes
    const beach = 1.5 - 15 * (tt - 0.9);
    h = lerp(h, beach, ss(0.84, 0.95, tt));
    if (tt > 0.92 && tt < 1.02) h += 0.12 * n.noise2(x * 0.2, z * 0.2);        // tidal-flat ripples
    if (h < -7) h = -7;
    const e = this.half - Math.max(Math.abs(x), Math.abs(z));                  // fade into the mist at the world edge
    h = lerp(-9, h, ss(-2, 12, e));
    return h;
  }
  /** terrain height including carved puddles, streams etc. */
  heightAt(x, z) {
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
  isShallow(x, z) { return this.tAt(x, z) > 0.95 && this.heightAt(x, z) < 0.12; }
  isSea(x, z) { return this.heightAt(x, z) < -0.25 && this.tAt(x, z) > 0.95; }

  // ---------------- terrain type ---------------------------------------------------
  isRoad(x, z, margin = 0) {
    if (this.progress(x, z) > 0.17) return false;
    const mx = (((x - this.roadOff.x) % 80) + 80) % 80;
    const mz = (((z - this.roadOff.z) % 80) + 80) % 80;
    const hw = 4.2 + margin;
    return mx < hw || mx > 80 - hw || mz < hw || mz > 80 - hw;
  }
  /** key of CONFIG-like TERRAIN table */
  baseType(x, z) {
    const n = this.n;
    const tt = this.tAt(x, z);
    if (tt > 1.0) return 'wet';
    if (tt < 0.2) {
      if (this.isRoad(x, z)) return 'road';
      return n.fbm(x * 0.02 + 8, z * 0.02) > 0.45 ? 'grass' : 'lawn';
    }
    const wm = n.fbm(x * 0.012 - 80, z * 0.012 + 30, 3);
    const f = n.fbm(x * 0.008 + 50, z * 0.008 - 20, 3);
    if (tt < 0.5) {
      if (wm > 0.3) return 'mud';
      return f > 0.02 ? 'forest' : 'grass';
    }
    if (tt < 0.72) {
      const r = n.fbm(x * 0.014 + 9, z * 0.014 - 4, 3);
      if (r > -0.05) return 'rock';
      if (wm > 0.42) return 'mud';
      return f > 0.2 ? 'grass' : 'scrub';
    }
    if (tt < 0.9) return n.fbm(x * 0.03, z * 0.03 + 4, 3) > 0.35 ? 'scrub' : 'dune';
    if (tt < 0.965) {
      return n.fbm(x * 0.05 + 3, z * 0.05 + 11, 2) > 0.38 ? 'rock' : 'sand';
    }
    return 'wet';
  }
  typeAt(x, z) {
    let t = this.baseType(x, z);
    // muddy / wet rim around puddles and streams
    const list = this.carveHash.at(x, z);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (Math.hypot(x - c.x, z - c.z) < c.r * 1.35) {
        if (t === 'sand' || t === 'dune' || t === 'wet') return 'wet';
        if (t === 'lawn' || t === 'grass' || t === 'forest' || t === 'scrub' || t === 'mud') return 'mud';
        break;
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
        if (!best || this.cfg.water[w.kind] > this.cfg.water[best.kind]) best = w;
      }
    }
    if (best) return best;
    for (const c of this.rain) if (Math.hypot(x - c.x, z - c.z) < c.r) return c;
    return null;
  }
  update(dt) {
    const lim = this.half - 30;
    for (const c of this.rain) {
      c.x += c.vx * dt; c.z += c.vz * dt;
      if (Math.abs(c.x) > lim) { c.vx *= -1; c.x = clamp(c.x, -lim, lim); }
      if (Math.abs(c.z) > lim) { c.vz *= -1; c.z = clamp(c.z, -lim, lim); }
    }
  }

  _addWater(kind, x, z, r, opts = {}) {
    const H = opts.H ?? this.baseHeight(x, z);
    const w = { kind, x, z, r, H, carve: opts.carve !== false, depth: opts.depth ?? 0.1 };
    this.waters.push(w);
    this.waterHash.add(x, z, r, w);
    if (w.carve) this.carveHash.add(x, z, r * 1.7, w);
    return w;
  }
  _slope(x, z, r) {
    const a = this.baseHeight(x + r, z), b = this.baseHeight(x - r, z), c = this.baseHeight(x, z + r), d = this.baseHeight(x, z - r);
    return Math.max(Math.abs(a - b), Math.abs(c - d)) / (2 * r);
  }
  _farFromWater(x, z, d) {
    for (const w of this.waters) if (Math.abs(w.x - x) < d && Math.abs(w.z - z) < d && Math.hypot(w.x - x, w.z - z) < d) return false;
    return true;
  }
  /** random land spot: progress range [t0,t1]; returns null after too many failures */
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
    // start somewhere in the garden zone, off the road
    let sx = this.dir.x * this.cStart, sz = this.dir.z * this.cStart;
    for (let i = 0; i < 60; i++) {
      const x = sx + this.rnd.range(-18, 18), z = sz + this.rnd.range(-18, 18);
      if (!this.isRoad(x, z, 12) && this._slope(x, z, 3) < 0.12) { sx = x; sz = z; break; }
    }
    this.start = { x: sx, z: sz };
  }

  _placeWater() {
    const W = this.cfg.water, rnd = this.rnd;
    const zoneAccept = (tt) => (tt < 0.5 ? 1 : tt < 0.72 ? 0.7 : tt < 0.9 ? 0.35 : 0.4);

    // A friendly drip tap + puddle near the start so the first seconds teach the idea.
    {
      const a = rnd() * Math.PI * 2, d = 9;
      const tx = this.start.x + Math.cos(a) * d, tz = this.start.z + Math.sin(a) * d;
      this._addWater('drip', tx, tz, 2.3, { depth: 0.12 });
      this.taps.push({ type: 'tap', x: tx, z: tz, rot: rnd() * 6.28 });
      const px = this.start.x - Math.cos(a) * 14, pz = this.start.z - Math.sin(a) * 14;
      this._addWater('puddle', px, pz, 3.2);
    }

    const put = (kind, count, t0, t1, rr, opts = {}) => {
      let made = 0;
      for (let i = 0; i < count * 6 && made < count; i++) {
        const s = this._spot(t0, t1, { maxSlope: opts.maxSlope ?? 0.1, slopeR: rr[1], minH: opts.minH ?? 1.2 });
        if (!s) continue;
        if (opts.zone && rnd() > zoneAccept(s.tt)) continue;
        if (!this._farFromWater(s.x, s.z, opts.spacing ?? 14)) continue;
        const r = rnd.range(rr[0], rr[1]);
        const tp = this.typeAt(s.x, s.z);
        if (tp === 'road') continue;
        this._addWater(kind, s.x, s.z, r, { depth: opts.depth ?? 0.1 });
        made++;
      }
    };

    put('puddle', W.puddleCount, 0.0, 0.9, [2.6, 4.4], { zone: true, spacing: 16 });
    put('pond', W.pondCount ?? 6, 0.12, 0.7, [6, 9], { spacing: 40, depth: 0.35, maxSlope: 0.07 });
    put('tidepool', W.tidepoolCount, 0.93, 0.995, [2.6, 4.2], { spacing: 14, minH: 0.25, maxSlope: 0.12 });

    // leaky taps (town) and dripping rock seeps (hills / meadow)
    {
      let made = 0;
      for (let i = 0; i < 400 && made < W.dripCount; i++) {
        const town = made < Math.ceil(W.dripCount / 2);
        const s = town ? this._spot(0.0, 0.18, { maxSlope: 0.12 }) : this._spot(0.25, 0.72, { maxSlope: 0.12 });
        if (!s || !this._farFromWater(s.x, s.z, 22)) continue;
        this._addWater('drip', s.x, s.z, 2.3, { depth: 0.1 });
        this.taps.push({ type: town ? 'tap' : 'seep', x: s.x, z: s.z, rot: rnd() * 6.28 });
        made++;
      }
    }

    // sprinklers on lawns (no carving, just a big wet zone)
    {
      let made = 0;
      // one close to the start
      const a = rnd() * 6.28;
      const first = { x: this.start.x + Math.cos(a) * 24, z: this.start.z + Math.sin(a) * 24 };
      const list = [];
      if (!this.isRoad(first.x, first.z, 8)) list.push(first);
      for (let i = 0; i < 300 && made + list.length < W.sprinklerCount; i++) {
        const s = this._spot(0.0, 0.34, { maxSlope: 0.1 });
        if (!s || !this._farFromWater(s.x, s.z, 24)) continue;
        list.push(s); made++;
      }
      for (const s of list) {
        const w = this._addWater('sprinkler', s.x, s.z, 6.5, { carve: false });
        this.sprinklers.push(w);
      }
    }

    // streams: meander downhill-ish, biased toward the sea (a gentle natural hint)
    for (let k = 0; k < W.streamCount; k++) {
      const s = this._spot(0.22, 0.62, { maxSlope: 0.3, tries: 200 });
      if (!s) continue;
      let x = s.x, z = s.z;
      let ang = Math.atan2(this.dir.z, this.dir.x) + rnd.range(-0.9, 0.9);
      const pts = [];
      const len = Math.floor(rnd.range(26, 55));
      for (let i = 0; i < len; i++) {
        pts.push({ x, z });
        // look slightly downhill
        const gx = this.baseHeight(x + 4, z) - this.baseHeight(x - 4, z);
        const gz = this.baseHeight(x, z + 4) - this.baseHeight(x, z - 4);
        const want = Math.atan2(this.dir.z * 0.7 - gz * 0.35, this.dir.x * 0.7 - gx * 0.35);
        let d = want - ang; d = Math.atan2(Math.sin(d), Math.cos(d));
        ang += d * 0.25 + rnd.range(-0.28, 0.28);
        x += Math.cos(ang) * 2.4; z += Math.sin(ang) * 2.4;
        if (Math.abs(x) > this.half - 50 || Math.abs(z) > this.half - 50 || this.tAt(x, z) > 0.88) break;
      }
      if (pts.length < 10) continue;
      // smooth the water heights along the path
      const hs = pts.map((p) => this.baseHeight(p.x, p.z));
      for (let i = 0; i < pts.length; i++) {
        let sum = 0, c = 0;
        for (let j = -4; j <= 4; j++) { const q = hs[clamp(i + j, 0, pts.length - 1)]; sum += q; c++; }
        // never flow uphill: cap at previous node height
        let H = sum / c;
        if (i > 0) H = Math.min(H, this._lastStreamH);
        this._lastStreamH = H;
        this._addWater('stream', pts[i].x, pts[i].z, 1.9, { H, depth: 0.1 });
      }
    }

    // rain clouds drifting around
    for (let i = 0; i < W.rainCloudCount; i++) {
      const s = this._spot(0.05, 0.85, { maxSlope: 9, minH: -5, notRoad: false, edge: 70 });
      if (!s) continue;
      const a = rnd() * 6.28;
      this.rain.push({ kind: 'rain', x: s.x, z: s.z, r: 12, vx: Math.cos(a) * W.rainCloudSpeed, vz: Math.sin(a) * W.rainCloudSpeed });
    }
    // one little shower near the start
    this.rain.push({ kind: 'rain', x: this.start.x + this.dir.x * 20 + 14, z: this.start.z + this.dir.z * 20 - 14, r: 12, vx: 0.5, vz: 0.3 });
  }

  _placeHouses() {
    const rnd = this.rnd;
    for (let i = 0; i < 400 && this.houses.length < 22; i++) {
      const s = this._spot(0.0, 0.17, { maxSlope: 0.18, slopeR: 5, tries: 20 });
      if (!s) continue;
      const w = rnd.range(8, 12), d = rnd.range(7, 10);
      if (Math.hypot(s.x - this.start.x, s.z - this.start.z) < 16) continue;
      if (this.isRoad(s.x, s.z, 6 + Math.max(w, d) * 0.5)) continue;
      if (this.houses.some((h) => Math.hypot(h.x - s.x, h.z - s.z) < 24)) continue;
      if (this.waters.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < q.r + 9)) continue;
      const house = { x: s.x, z: s.z, w, d, h: rnd.range(4, 6), y: this.baseHeight(s.x, s.z), color: rnd.pick([0xe8d9c2, 0xd9b99b, 0xc9d6df, 0xefe6a9, 0xd4a5a0, 0xb8c9a3]), roof: rnd.pick([0xa14b3a, 0x5a5f6b, 0x7a4a3a]) };
      this.houses.push(house);
      this.colliders.push({ x: s.x, z: s.z, hw: w / 2 + 0.3, hd: d / 2 + 0.3 });
      this.colHash.add(s.x, s.z, Math.max(w, d), this.colliders[this.colliders.length - 1]);
    }
  }

  _addCircle(x, z, r) {
    const c = { x, z, r };
    this.colliders.push(c);
    this.colHash.add(x, z, r, c);
  }

  _blocked(x, z, pad = 0) {
    if (this.isRoad(x, z, 0) && false) return true;
    for (const w of this.waterHash.at(x, z)) if (w.kind !== 'sprinkler' && Math.hypot(x - w.x, z - w.z) < w.r * 1.5 + pad) return true;
    for (const c of this.colHash.at(x, z)) {
      if (c.r !== undefined) { if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true; }
      else if (Math.abs(x - c.x) < c.hw + pad + 1 && Math.abs(z - c.z) < c.hd + pad + 1) return true;
    }
    return false;
  }

  _placeDecor() {
    const G = this.cfg.graphics, rnd = this.rnd;
    const trees = [], rocks = [], grass = [], flowers = [], beach = [], reeds = [];
    const edge = 30;
    const rx = () => rnd.range(-this.half + edge, this.half - edge);
    const away = (x, z) => Math.hypot(x - this.start.x, z - this.start.z) > 7;

    // trees & bushes
    let tries = 0;
    while (trees.length < G.treeCount && tries++ < G.treeCount * 25) {
      const x = rx(), z = rx();
      const tp = this.baseType(x, z);
      const tt = this.tAt(x, z);
      let kind = null, p = 0;
      switch (tp) {
        case 'forest': p = 0.55; kind = rnd() < 0.6 ? 'pine' : 'oak'; break;
        case 'grass': p = 0.05; kind = rnd() < 0.5 ? 'oak' : 'bush'; break;
        case 'lawn': p = 0.05; kind = rnd() < 0.7 ? 'oak' : 'bush'; break;
        case 'scrub': p = tt > 0.72 ? 0.07 : 0.12; kind = 'bush'; break;
        case 'rock': p = tt > 0.85 ? 0 : 0.04; kind = rnd() < 0.5 ? 'pine' : 'bush'; break;
        case 'mud': p = 0.08; kind = 'bush'; break;
        case 'sand': p = tt < 0.93 ? 0.03 : 0.0; kind = 'palm'; break;
        case 'dune': p = 0.01; kind = 'bush'; break;
        default: p = 0;
      }
      if (!kind || rnd() > p) continue;
      if (!away(x, z) || this.isRoad(x, z, 2) || this._blocked(x, z, 1.2)) continue;
      const h = this.heightAt(x, z);
      if (h < 0.9) continue;
      const scale = kind === 'bush' ? rnd.range(0.7, 1.4) : rnd.range(0.8, 1.7);
      trees.push({ x, z, y: h, kind, scale, rot: rnd() * 6.28, tint: rnd.range(0.82, 1.1) });
      if (kind !== 'bush') this._addCircle(x, z, 0.55 * scale);
    }

    // rocks
    tries = 0;
    while (rocks.length < G.rockCount && tries++ < G.rockCount * 40) {
      const x = rx(), z = rx();
      const tp = this.baseType(x, z);
      const tt = this.tAt(x, z);
      const p = tp === 'rock' ? (tt > 0.9 ? 0.07 : 0.5) : tp === 'scrub' ? 0.05 : tp === 'sand' ? 0.02 : tp === 'grass' || tp === 'mud' ? 0.03 : 0;
      if (rnd() > p) continue;
      if (!away(x, z) || this._blocked(x, z, 1)) continue;
      const h = this.heightAt(x, z);
      if (h < 0.7) continue;
      const size = rnd() < 0.12 ? rnd.range(2.2, 4) : rnd.range(0.5, 1.8);
      rocks.push({ x, z, y: h, size, rot: rnd() * 6.28, sy: rnd.range(0.55, 1.0), tint: rnd.range(0.8, 1.1) });
      this._addCircle(x, z, size * 0.85);
      if (size > 2.4 && rnd() < 0.5 && this.cfg.water.dripCount > 0 && this._farFromWater(x, z, 12)) { /* big rocks stay purely scenic */ }
    }

    // grass tufts and flowers
    tries = 0;
    while (grass.length < G.grassCount && tries++ < G.grassCount * 8) {
      const x = rx(), z = rx();
      const tp = this.baseType(x, z);
      const p = tp === 'lawn' ? 0.9 : tp === 'grass' ? 1 : tp === 'forest' ? 0.6 : tp === 'scrub' ? 0.5 : tp === 'dune' ? 0.18 : tp === 'mud' ? 0.15 : 0;
      if (rnd() > p) continue;
      if (this.isRoad(x, z, 1)) continue;
      const h = this.heightAt(x, z);
      if (h < 0.9) continue;
      grass.push({ x, z, y: h, s: rnd.range(0.7, 1.5) * (tp === 'dune' ? 1.4 : 1), rot: rnd() * 6.28, dry: tp === 'scrub' || tp === 'dune', tint: rnd.range(0.8, 1.15) });
    }
    tries = 0;
    while (flowers.length < G.flowerCount && tries++ < G.flowerCount * 12) {
      const x = rx(), z = rx();
      const tp = this.baseType(x, z);
      if (tp !== 'lawn' && tp !== 'grass') continue;
      const h = this.heightAt(x, z);
      if (h < 1 || this.isRoad(x, z, 1)) continue;
      flowers.push({ x, z, y: h, color: rnd.pick([0xffe066, 0xff8fa3, 0xffffff, 0xc77dff, 0xff9f45]), s: rnd.range(0.7, 1.2) });
    }

    // beach bits: shells, seaweed, driftwood
    for (let i = 0; i < 700 && beach.length < 280; i++) {
      const x = rx(), z = rx();
      const tt = this.tAt(x, z);
      if (tt < 0.9 || tt > 1.0) continue;
      const h = this.heightAt(x, z);
      if (h < 0.05) continue;
      const kind = rnd.pick(['shell', 'shell', 'weed', 'weed', 'wood']);
      beach.push({ x, z, y: h, kind, rot: rnd() * 6.28, s: rnd.range(0.7, 1.4) });
    }

    // reeds around water
    for (const w of this.waters) {
      if (w.kind === 'sprinkler') continue;
      if (w.kind === 'stream' && rnd() < 0.6) continue;
      const n = w.kind === 'pond' ? 12 : w.kind === 'stream' ? 1 : 3;
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.28, d = w.r * rnd.range(1.0, 1.35);
        const x = w.x + Math.cos(a) * d, z = w.z + Math.sin(a) * d;
        if (this.baseType(x, z) === 'road') continue;
        const tp = this.baseType(x, z);
        if (tp === 'sand' || tp === 'dune' || tp === 'wet') continue;
        reeds.push({ x, z, y: this.heightAt(x, z), s: rnd.range(0.8, 1.6), rot: rnd() * 6.28 });
      }
    }
    return { trees, rocks, grass, flowers, beach, reeds };
  }

  // ---------------- collisions -----------------------------------------------------
  /** push a circle of radius `rad` at (x,z) out of obstacles; returns {x,z,hit} */
  resolve(x, z, rad, out = { x, z, hit: false }) {
    out.x = x; out.z = z; out.hit = false;
    for (let pass = 0; pass < 2; pass++) {
      const list = this.colHash.at(out.x, out.z);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c.r !== undefined) {
          const dx = out.x - c.x, dz = out.z - c.z;
          const d = Math.hypot(dx, dz), m = c.r + rad;
          if (d < m) {
            const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
            out.x = c.x + nx * m; out.z = c.z + nz * m; out.hit = true;
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
            out.hit = true;
          }
        }
      }
    }
    const lim = this.half - 14;
    out.x = clamp(out.x, -lim, lim); out.z = clamp(out.z, -lim, lim);
    return out;
  }

  /** habitat sampling for predators: returns a random free spot whose terrain type satisfies `ok` */
  habitatSpot(tMin, tMax, types, minFromStart = 35) {
    for (let i = 0; i < 400; i++) {
      const x = this.rnd.range(-this.half + 40, this.half - 40);
      const z = this.rnd.range(-this.half + 40, this.half - 40);
      const tt = this.tAt(x, z);
      if (tt < tMin || tt > tMax) continue;
      if (Math.hypot(x - this.start.x, z - this.start.z) < minFromStart) continue;
      if (types && !types.includes(this.baseType(x, z))) continue;
      const h = this.heightAt(x, z);
      if (h < 0.3) continue;
      if (this._blocked(x, z, 1.5)) continue;
      return { x, z };
    }
    return null;
  }
}
