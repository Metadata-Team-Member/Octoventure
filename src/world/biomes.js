// =====================================================================
//  Biomes - the pure (no three.js) description of WHERE each kind of place is.
//
//  Banded world (see bands.js): south (+z) is the sea, then shore, suburb/town/farm, bush, mud flats | outback, wasteland,
//  ringed by mountains. The older notes below describe the coast stretches, which still apply along the shore.
//  Layout idea (inland -> coast, along the sea direction `dir`, which now always points south):
//     suburb / town  ->  farm  ->  bushland (eucalypt)  ->  coast
//  with a creek (riverbank) winding through to the estuary, and the coast itself changing
//  along the shoreline in a fixed, natural order (headland > beach > estuary > mangroves, repeating):
//     rocky headland  |  beach (with dunes behind)  |  estuary (river mouth + jetty)  |  mangrove wetland
//  The same fixed world for everyone (CONFIG.worldSeed): inland the regions are a warped patchwork
//  (hamlets in the farmland, farm clearings in the bush, ...) so one place hands over to the next.
//  Everything is a smooth blend of weights, so borders are soft (and never a hard seam).
// =====================================================================
import { smoothstep as ss, clamp } from '../util/rng.js';
import { BANDS } from './bands.js';

/** warped northing for the band edges. A long wave in x (so walking due north still crosses each edge once)
 *  plus a little noise, about ±45 m. Callers blend across ~30 m (the 10–30 m hand-over). */
export function bandZw(n, x, z) {
  const wave = Math.sin(x * 0.008 + 0.55) * 24 + Math.sin(x * 0.0185 + 1.35) * 9;
  const nse = n.fbm(x * 0.0042 + 101, z * 0.0042 - 57, 2) * 12 + n.fbm(x * 0.013 - 8, z * 0.013 + 3, 2) * 4;
  return z + wave + nse;
}

export const BIOMES = ['suburb', 'town', 'farm', 'bush', 'riverbank', 'wetland', 'dunes', 'beach', 'headland', 'estuary', 'sea', 'desert', 'rainforest', 'mudflat', 'wasteland'];   // (t241u: desert + rainforest appended; banded world: mud flats + wasteland appended)
export const B = Object.fromEntries(BIOMES.map((n, i) => [n, i]));
export const NB = BIOMES.length;

/** per-biome look & feel: lighting tint, fog thickness and the ambient-sound mix (used by Atmosphere and GameAudio) */
export const BIOME_INFO = {
  suburb:    { label: 'Suburban backyards',  tint: 0xffffff, fog: 1.0,  amb: { hum: 0.5, birds: 0.5 } },
  town:      { label: 'Streets & car park',  tint: 0xe6e8f0, fog: 0.95, amb: { hum: 1.0 } },
  farm:      { label: 'Farmland',            tint: 0xffe9b8, fog: 1.05, amb: { wind: 1.0, birds: 0.6, cows: 1.0 } },
  bush:      { label: 'Eucalypt bushland',   tint: 0xd8efc8, fog: 0.85, amb: { birds: 1.0 } },
  riverbank: { label: 'Creek & riverbank',   tint: 0xcfe8f0, fog: 0.9,  amb: { babble: 1.0, birds: 0.5 } },
  wetland:   { label: 'Wetlands & mangroves', tint: 0xc9dcc0, fog: 0.62, amb: { frogs: 1.0, babble: 0.2 } },
  dunes:     { label: 'Dunes',               tint: 0xfff0c8, fog: 1.1,  amb: { wind: 1.0, surf: 0.5 } },
  beach:     { label: 'Beach',               tint: 0xfffbe6, fog: 1.15, amb: { surf: 1.0, gulls: 0.6 } },
  headland:  { label: 'Rocky headland',      tint: 0xd5dfee, fog: 0.9,  amb: { surf: 1.0, wind: 0.8, gulls: 0.5 } },
  estuary:   { label: 'Estuary & jetty',     tint: 0xd9efee, fog: 0.8,  amb: { gulls: 1.0, babble: 0.5, surf: 0.4 } },
  sea:       { label: 'Open sea',            tint: 0xc4e8f4, fog: 1.0,  amb: { surf: 1.0 } },
  desert:    { label: 'Red desert',          tint: 0xffd2a8, fog: 1.2,  amb: { wind: 1.0 } },
  rainforest:{ label: 'Rainforest gully',    tint: 0xbfe0b0, fog: 0.55, amb: { birds: 1.0, babble: 0.5, frogs: 0.3 } },
  mudflat:   { label: 'Mud flats',           tint: 0xe2d8c4, fog: 0.85, amb: { frogs: 0.6, wind: 0.5 } },
  wasteland: { label: 'Wasteland',           tint: 0xe6d6ee, fog: 0.8,  amb: { wind: 1.0, hum: 0.6 } },
};

export const COAST_KINDS = ['beach', 'mangrove', 'headland', 'estuary'];

export class BiomeField {
  /** world: {n (noise), tAt(x,z), lateral(x,z), creekDist(x,z), coast: {segments, period, shift}} */
  constructor(world) {
    this.world = world;
    this._w = new Float32Array(NB);
    this._ck = new Float32Array(4);
  }

  /** soft weights of the four coastal stretches at lateral position u (periodic) */
  coastKinds(u, out = this._ck) {
    const c = this.world.coast;
    let p = (u - c.shift) % c.period; if (p < 0) p += c.period;
    out.fill(0);
    const e = 55;     // blend width
    for (const s of c.segments) {
      for (const off of [-c.period, 0, c.period]) {
        const a = s.a + off, b = s.b + off;
        if (p < a - e || p > b + e) continue;
        out[s.kind] += ss(a - e, a + e, p) - ss(b - e, b + e, p);
      }
    }
    let sum = out[0] + out[1] + out[2] + out[3];
    if (sum < 1e-4) { out[0] = 1; sum = 1; }
    for (let i = 0; i < 4; i++) out[i] /= sum;
    return out;
  }

  /** normalised weights (sum 1) of every biome at x,z. The returned array is reused - copy it if you keep it. */
  weights(x, z, w = this._w) {
    const W = this.world, n = W.n;
    w.fill(0);
    const tw = W.tAt(x, z);
    const u = W.lateral(x, z);
    // ---- the bands, south to north (see bands.js). Borders wave and hand over in about 30 m.
    const zw = bandZw(n, x, z);
    const xw = x + n.fbm(x * 0.005 - 40, z * 0.005 + 90, 2) * 55;
    const up = (e) => ss(e - 15, e + 15, zw);                 // 1 on the south side of a band edge
    const eWaste = BANDS[5].z1, eOut = BANDS[4].z1, eBush = BANDS[3].z1;
    const waste = 1 - up(eWaste);
    const outback = up(eWaste) * (1 - up(eOut));
    const bushB = up(eOut) * (1 - up(eBush));
    const townB = up(eBush);
    // mud flats on the west, red outback on the east
    const east = ss(-50, 50, xw);
    w[B.mudflat] = outback * (1 - east);
    w[B.desert] = outback * east;
    // bush band: a rainforest corner in the west, a wetland pocket beside it, gum forest everywhere else
    const rain = 1 - ss(-470, -410, xw);
    const wd = Math.hypot((xw + 250) / 1.5, zw + 160) + n.fbm(x * 0.02 + 7, z * 0.02 - 3, 2) * 25;
    const wet = (1 - ss(70, 105, wd)) * (1 - rain);
    w[B.rainforest] = bushB * rain;
    w[B.wetland] = bushB * wet;
    w[B.bush] = bushB * (1 - rain) * (1 - wet);
    // suburb + town (the town centre in the middle), farms and green fields north of them and out on both flanks
    const sub = ss(110, 150, zw) * ss(-370, -310, xw) * (1 - ss(430, 490, xw));
    const town = sub * (1 - ss(120, 170, Math.abs(xw - 40))) * ss(168, 212, zw) * (1 - ss(280, 325, zw));
    w[B.town] = townB * town;
    w[B.suburb] = townB * (sub - town);
    w[B.farm] = townB * (1 - sub);
    w[B.wasteland] = waste;
    // ---- coast -------------------------------------------------------------------------
    const coast = ss(0.78, 0.84, tw);
    if (coast > 0) {
      for (let i = 0; i < NB; i++) w[i] *= 1 - coast;
      const ck = this.coastKinds(u);
      const beachK = ck[0], mangK = ck[1], headK = ck[2], estK = ck[3];
      w[B.dunes] += coast * beachK * (1 - ss(0.885, 0.945, tw));
      w[B.beach] += coast * beachK * ss(0.885, 0.945, tw);
      w[B.wetland] += coast * (mangK + estK * (1 - ss(0.845, 0.915, tw)));
      w[B.headland] += coast * headK;
      w[B.estuary] += coast * estK * ss(0.845, 0.915, tw);
    }
    // ---- sea beyond the shoreline ----------------------------------------------------------
    const sea = ss(0.97, 1.045, tw);
    if (sea > 0) {
      for (let i = 0; i < NB; i++) w[i] *= 1 - sea;
      w[B.sea] = sea;
    }
    // ---- the river runs from the northern ranges to the estuary (quieter where it crosses the outback and the wasteland) ----
    const cd = W.creekDist(x, z);
    if (cd < 24) {
      let rb = (1 - ss(5, 22, cd)) * (1 - ss(0.78, 0.9, tw)) * (1 - sea);
      rb *= 1 - 0.85 * clamp(w[B.wetland] + w[B.estuary] + w[B.headland] + w[B.beach] + w[B.dunes] + w[B.town] * 0.5, 0, 1);
      rb *= (1 - 0.9 * w[B.wasteland]) * (1 - 0.6 * w[B.desert]) * (1 - 0.5 * w[B.mudflat]);
      if (rb > 0) {
        for (let i = 0; i < NB; i++) w[i] *= 1 - rb;
        w[B.riverbank] = rb;
      }
    }
    let sum = 0;
    for (let i = 0; i < NB; i++) sum += w[i];
    if (sum < 1e-6) { w[B.bush] = 1; sum = 1; }
    for (let i = 0; i < NB; i++) w[i] /= sum;
    return w;
  }

  /**
   * a biome id drawn AT RANDOM in proportion to the weights at x,z (u = a uniform random number). In the middle of a biome this is
   * always that biome; across a blended ecotone it hands out both, so trees, rocks and props of the two biomes intermix and thin out
   * instead of stopping at a line.
   */
  sample(x, z, u) {
    const q = this.weights(x, z); let acc = 0;
    for (let i = 0; i < NB; i++) { acc += q[i]; if (u <= acc) return i; }
    return this.at(x, z);
  }

  /** index of the dominant biome */
  at(x, z) {
    const w = this.weights(x, z);
    let best = 0;
    for (let i = 1; i < NB; i++) if (w[i] > w[best]) best = i;
    return best;
  }
  nameAt(x, z) { return BIOMES[this.at(x, z)]; }
}
